import type { SearchAdapter } from "../search/types.js";
import type { IndexError, SearchDocument } from "./types.js";
export interface BulkIndexerOptions {
    batchSize?: number;
    concurrency?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
}
export interface BulkIndexResult {
    indexed: number;
    failed: number;
    errors: IndexError[];
}
/**
 * Bulk document writer over any `SearchAdapter` (Phase 8).
 *
 * Documents are written in batches with per-document retry and
 * per-document error collection — one bad document never aborts
 * the run.
 */
export declare class BulkIndexer {
    private readonly search;
    private readonly batchSize;
    private readonly concurrency;
    private readonly retryAttempts;
    private readonly retryDelayMs;
    constructor(search: SearchAdapter, options?: BulkIndexerOptions);
    indexDocuments(index: string, documents: SearchDocument[], tenantField?: string): Promise<BulkIndexResult>;
    private indexOne;
}
//# sourceMappingURL=bulk.d.ts.map