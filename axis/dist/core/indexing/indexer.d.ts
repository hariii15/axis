import type { Database } from "../database/database.js";
import type { ModelRegistry } from "../../model/registry.js";
import type { EmbeddingProvider } from "../embeddings/types.js";
import type { SearchAdapter } from "../search/types.js";
import type { DocumentTransformer, Indexer, IndexOptions, IndexResult, IndexStatus, ReindexOptions } from "./types.js";
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
export declare class ModelIndexer implements Indexer {
    readonly name = "model-indexer";
    private readonly database;
    private readonly registry;
    private readonly search;
    private readonly embeddings;
    private readonly transformerOverride;
    private readonly batchSize;
    private readonly concurrency;
    private readonly retryAttempts;
    private readonly retryDelayMs;
    private readonly tenantField;
    private readonly timestampField;
    constructor(options: ModelIndexerOptions);
    index(model: string, options?: IndexOptions): Promise<IndexResult>;
    reindex(model: string, options?: ReindexOptions): Promise<IndexResult>;
    deleteIndex(model: string): Promise<void>;
    getStatus(model: string): Promise<IndexStatus>;
    close(): Promise<void>;
    private fillEmbeddings;
    private fetchRows;
}
//# sourceMappingURL=indexer.d.ts.map