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
export declare class DefaultDocumentTransformer implements DocumentTransformer {
    private readonly model;
    private readonly tenantField;
    constructor(model: ModelDefinition, options?: DocumentTransformerOptions);
    getEmbeddingInput(record: Record<string, unknown>): string;
    transform(record: Record<string, unknown>): Promise<SearchDocument>;
    private resolveId;
}
//# sourceMappingURL=transformer.d.ts.map