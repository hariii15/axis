import type { ResolvedQuery } from "../resolver/type.js";
import type { DataSourceName } from "../planner/types.js";

export type { DataSourceName };

/**
 * A physical data backend behind the identical semantic layer.
 *
 * The resolved query (root model + joins + axes/metrics/filters) is
 * the same for every datasource — only the scan implementation
 * differs (OpenSearch storage+engine vs S3 JSON vs S3 Parquet).
 */
export interface DataSource {
  readonly name: DataSourceName;
  /**
   * Execute a resolved (possibly multi-model) query and return flat
   * denormalized rows: root-model fields are bare (`companyName`),
   * joined-model fields are dotted (`ContactInfo.email`).
   * Pagination (limit/offset) is applied by the datasource.
   */
  scan(request: DataScanRequest): Promise<DataScanResult>;
}

export interface DataScanRequest {
  resolved: ResolvedQuery;
  /** Prebuilt OpenSearch security DSL filters (root fetch only). */
  securityFilters?: Record<string, unknown>[];
  /** Query embedding for semantic/hybrid search. */
  queryVector?: number[];
}

export interface DataScanResult {
  rows: Record<string, unknown>[];
  /**
   * Total rows before pagination for document queries;
   * equals rows.length for aggregated queries.
   */
  rowCount: number;
}

/** Fetch raw documents (bare field names) for one model. */
export type ModelDocFetcher = (modelName: string) => Promise<Record<string, unknown>[]>;
