import type { ModelDefinition } from "../../model/types.js";
import type { DocumentTransformer, SearchDocument } from "./types.js";

export interface DocumentTransformerOptions {
  /** Record field carrying the tenant id. @default "tenant_id" */
  tenantField?: string;
}

/**
 * Default model-driven document transformer (Phase 8).
 *
 * - `id`: value of the primaryKey axis column (`definition.sql`).
 * - `fields`: keyed by search field (`axis.search.field ?? axis name`),
 *   values read from the DB column (`axis.sql`).
 * - `searchableText`: `model.search.embeddingInput` values joined,
 *   falling back to all string axis values.
 * - `tenantId`: `record[tenantField]` when present.
 *
 * Embedding vectors are filled in later by the indexer, not here.
 */
export class DefaultDocumentTransformer implements DocumentTransformer {
  private readonly model: ModelDefinition;
  private readonly tenantField: string;

  constructor(model: ModelDefinition, options: DocumentTransformerOptions = {}) {
    this.model = model;
    this.tenantField = options.tenantField ?? "tenant_id";
  }

  getEmbeddingInput(record: Record<string, unknown>): string {
    const inputAxes =
      this.model.search?.embeddingInput ?? this.model.search?.searchable ?? [];
    const names =
      inputAxes.length > 0 ? inputAxes : Object.keys(this.model.axes);
    const parts: string[] = [];
    for (const name of names) {
      const axis = this.model.axes[name];
      if (axis === undefined) continue;
      const value = record[axis.sql];
      if (typeof value === "string" && value.length > 0) {
        parts.push(value);
      } else if (typeof value === "number" || typeof value === "boolean") {
        parts.push(String(value));
      }
    }
    return parts.join("\n");
  }

  async transform(record: Record<string, unknown>): Promise<SearchDocument> {
    const id = this.resolveId(record);
    const fields: Record<string, unknown> = {};
    for (const [name, axis] of Object.entries(this.model.axes)) {
      let value = record[axis.sql];
      if (value === undefined) {
        continue;
      }
      // node-pg returns NUMERIC columns as strings ("45000"). Indexing
      // those as text would break range filters — coerce to real numbers.
      if (
        axis.type === "number" &&
        typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(Number(value))
      ) {
        value = Number(value);
      }
      fields[axis.search?.field ?? name] = value;
    }

    const doc: SearchDocument = { id, fields };
    const searchableText = this.getEmbeddingInput(record);
    if (searchableText.length > 0) {
      doc.searchableText = searchableText;
    }

    const tenant = record[this.tenantField];
    if (typeof tenant === "string" && tenant.length > 0) {
      doc.tenantId = tenant;
    } else if (
      typeof tenant === "number" ||
      typeof tenant === "boolean" ||
      typeof tenant === "bigint"
    ) {
      doc.tenantId = String(tenant);
    }

    return doc;
  }

  private resolveId(record: Record<string, unknown>): string {
    const axes = Object.entries(this.model.axes);
    const primary = axes.find(([, axis]) => axis.primaryKey === true);
    const candidates = [
      primary?.[1].sql,
      this.model.axes["id"]?.sql,
      "id",
    ].filter((c): c is string => typeof c === "string");
    for (const column of candidates) {
      const value = record[column];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      ) {
        return String(value);
      }
    }
    throw new Error(
      `Cannot resolve document id for model "${this.model.name}": ` +
        `no value for [${candidates.join(", ")}].`,
    );
  }
}
