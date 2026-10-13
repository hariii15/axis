import type { Database } from "../database/database.js";
import type { ModelRegistry } from "../../model/registry.js";
import type { ModelSource } from "../../model/types.js";
import type { EmbeddingProvider } from "../embeddings/types.js";
import type { SearchAdapter } from "../search/types.js";
import { BulkIndexer } from "./bulk.js";
import { DefaultDocumentTransformer } from "./transformer.js";
import type {
  DocumentTransformer,
  Indexer,
  IndexOptions,
  IndexResult,
  IndexStatus,
  ReindexOptions,
  SearchDocument,
} from "./types.js";

export interface ModelIndexerOptions {
  database: Database;
  registry: ModelRegistry;
  search: SearchAdapter;
  embeddings?: EmbeddingProvider;
  transformer?: DocumentTransformer;
  batchSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  tenantField?: string;
  timestampField?: string;
}

const DEFAULT_TIMESTAMP_FIELD = "updated_at";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Model indexer: PostgreSQL → transform → embed → OpenSearch (Phase 8).
 *
 * - Reads raw rows from the model's table (`SELECT *`, equality `where`,
 *   optional `since` on a timestamp column, `limit`/`offset`).
 * - Transforms rows with the model search field mappings (Phase 4).
 * - Generates vectors with the embedding provider when the model
 *   declares `search.embeddingInput` (fail-closed when no provider).
 * - Bulk-writes with per-document retry (never aborts on one bad doc).
 *
 * Only `table` sources are supported for extraction in this phase.
 */
export class ModelIndexer implements Indexer {
  readonly name = "model-indexer";
  private readonly database: Database;
  private readonly registry: ModelRegistry;
  private readonly search: SearchAdapter;
  private readonly embeddings: EmbeddingProvider | undefined;
  private readonly transformerOverride: DocumentTransformer | undefined;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly tenantField: string;
  private readonly timestampField: string;

  constructor(options: ModelIndexerOptions) {
    this.database = options.database;
    this.registry = options.registry;
    this.search = options.search;
    this.embeddings = options.embeddings;
    this.transformerOverride = options.transformer;
    this.batchSize = options.batchSize ?? 100;
    this.concurrency = options.concurrency ?? 4;
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.tenantField = options.tenantField ?? "tenant_id";
    this.timestampField = options.timestampField ?? DEFAULT_TIMESTAMP_FIELD;
  }

  async index(model: string, options: IndexOptions = {}): Promise<IndexResult> {
    const started = Date.now();
    const definition = this.registry.get(model);
    const search = definition.search;
    if (search === undefined || search.index.length === 0) {
      throw new Error(
        `Model "${model}" has no search index configured (model.search.index).`,
      );
    }

    const needsEmbeddings =
      (search.embeddingInput ?? []).length > 0 && options.skipEmbeddings !== true;
    if (needsEmbeddings && this.embeddings === undefined) {
      throw new Error(
        `Model "${model}" declares search.embeddingInput but no embedding provider is configured.`,
      );
    }

    const transformer =
      options.transform ??
      this.transformerOverride ??
      new DefaultDocumentTransformer(definition, {
        tenantField: options.tenantField ?? this.tenantField,
      });

    const rows = await this.fetchRows(definition.source, options);

    const documents: SearchDocument[] = [];
    const errors: IndexResult["errors"] = [];
    let failed = 0;
    for (const row of rows) {
      try {
        documents.push(await transformer.transform(row));
      } catch (error) {
        failed += 1;
        errors.push({
          id: "unknown",
          error: error instanceof Error ? error.message : String(error),
          document: row,
        });
      }
    }

    if (needsEmbeddings && this.embeddings !== undefined) {
      await this.fillEmbeddings(
        documents,
        options.batchSize ?? this.batchSize,
      );
    }

    const bulk = new BulkIndexer(this.search, {
      batchSize: options.batchSize ?? this.batchSize,
      concurrency: this.concurrency,
      retryAttempts: this.retryAttempts,
      retryDelayMs: this.retryDelayMs,
    });
    const written = await bulk.indexDocuments(
      search.index,
      documents,
      options.tenantField ?? this.tenantField,
    );

    return {
      model,
      indexed: written.indexed,
      updated: 0,
      deleted: 0,
      failed: failed + written.failed,
      errors: [...errors, ...written.errors],
      durationMs: Date.now() - started,
    };
  }

  async reindex(model: string, options: ReindexOptions = {}): Promise<IndexResult> {
    if (options.dropExisting === true) {
      try {
        await this.deleteIndex(model);
      } catch {
        // Index may not exist yet — continue with a fresh index.
      }
    }
    return this.index(model, options);
  }

  async deleteIndex(model: string): Promise<void> {
    const definition = this.registry.get(model);
    const index = definition.search?.index;
    if (index === undefined || index.length === 0) {
      throw new Error(
        `Model "${model}" has no search index configured (model.search.index).`,
      );
    }
    await this.search.deleteIndex(index);
  }

  async getStatus(model: string): Promise<IndexStatus> {
    const definition = this.registry.get(model);
    const index = definition.search?.index;
    if (index === undefined || index.length === 0) {
      throw new Error(
        `Model "${model}" has no search index configured (model.search.index).`,
      );
    }
    const result = await this.search.search({
      index,
      query: { matchAll: {} },
      size: 0,
    });
    const total =
      typeof result.total === "number" ? result.total : result.total.value;
    return { model, documentCount: total, isIndexing: false };
  }

  async close(): Promise<void> {
    // Owns neither the database pool nor the search client.
  }

  private async fillEmbeddings(
    documents: SearchDocument[],
    batchSize: number,
  ): Promise<void> {
    const provider = this.embeddings;
    if (provider === undefined) return;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const texts = batch.map((doc) => doc.searchableText ?? "");
      const vectors = await provider.embedBatch(texts);
      for (let j = 0; j < batch.length; j += 1) {
        const doc = batch[j];
        const vector = vectors[j];
        if (doc !== undefined && vector !== undefined) {
          doc.embedding = vector;
        }
      }
    }
  }

  private async fetchRows(
    source: ModelSource,
    options: IndexOptions,
  ): Promise<Record<string, unknown>[]> {
    if (source.type !== "table") {
      throw new Error(
        `Index extraction supports table sources only (got "${source.type}").`,
      );
    }
    assertIdentifier(source.table);
    const conditions: string[] = [];
    const parameters: unknown[] = [];

    const where = options.where ?? {};
    for (const [field, value] of Object.entries(where)) {
      assertIdentifier(field);
      parameters.push(value);
      conditions.push(`${field} = $${parameters.length}`);
    }

    if (options.since !== undefined) {
      const timestampField = options.timestampField ?? this.timestampField;
      assertIdentifier(timestampField);
      const since =
        options.since instanceof Date
          ? options.since.toISOString()
          : options.since;
      parameters.push(since);
      conditions.push(`${timestampField} >= $${parameters.length}`);
    }

    let sql = `SELECT * FROM ${source.table}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    if (options.limit !== undefined) {
      parameters.push(options.limit);
      sql += ` LIMIT $${parameters.length}`;
    }
    if (options.offset !== undefined) {
      parameters.push(options.offset);
      sql += ` OFFSET $${parameters.length}`;
    }

    const result = await this.database.query(sql, parameters);
    return result.rows as Record<string, unknown>[];
  }
}

function assertIdentifier(name: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Unsafe SQL identifier "${name}".`);
  }
}
