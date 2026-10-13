export interface IndexingConfig {
  enabled?: boolean;
  indexer?: Indexer;
  batchSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export interface Indexer {
  name: string;
  index(model: string, options?: IndexOptions): Promise<IndexResult>;
  reindex(model: string, options?: ReindexOptions): Promise<IndexResult>;
  deleteIndex(model: string): Promise<void>;
  getStatus(model: string): Promise<IndexStatus>;
  close(): Promise<void>;
}

export interface IndexOptions {
  since?: Date | string;
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  transform?: DocumentTransformer;
  /**
   * Timestamp column used with `since` (Phase 8).
   * @default "updated_at"
   */
  timestampField?: string;
  /**
   * Record field carrying the tenant id (Phase 8).
   * @default "tenant_id"
   */
  tenantField?: string;
  /** Batch size override for this run (defaults to IndexingConfig). */
  batchSize?: number;
  /**
   * Skip vector generation for this run (generic — e.g. the embedding
   * service is unreachable). Documents are indexed without the
   * `embedding` field; re-run without this flag later to backfill.
   * Structured search, filters and aggregations are unaffected.
   * @default false
   */
  skipEmbeddings?: boolean;
}

export interface ReindexOptions extends IndexOptions {
  dropExisting?: boolean;
}

export interface IndexResult {
  model: string;
  indexed: number;
  updated: number;
  deleted: number;
  failed: number;
  errors: IndexError[];
  durationMs: number;
}

export interface IndexError {
  id: string;
  error: string;
  document?: Record<string, unknown>;
}

export interface IndexStatus {
  model: string;
  lastIndexedAt?: Date;
  documentCount: number;
  indexSizeBytes?: number;
  isIndexing: boolean;
}

export interface DocumentTransformer {
  transform(record: Record<string, unknown>): Promise<SearchDocument>;
  getEmbeddingInput?(record: Record<string, unknown>): string | string[];
}

export interface SearchDocument {
  id: string;
  tenantId?: string;
  fields: Record<string, unknown>;
  embedding?: number[];
  searchableText?: string;
}

export interface ChangeDetector {
  getChanges(model: string, since: Date): Promise<ChangeEvent[]>;
}

export interface ChangeEvent {
  type: "insert" | "update" | "delete";
  id: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface IncrementalIndexerConfig extends IndexingConfig {
  changeDetector?: ChangeDetector;
  schedule?: string;
}