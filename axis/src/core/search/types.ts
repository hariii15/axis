export interface SearchConfig {
  enabled?: boolean;
}

export interface SearchAdapter {
  name: string;
  search(params: SearchParams): Promise<SearchResult>;
  index(params: IndexParams): Promise<SearchIndexResult>;
  deleteIndex(index: string): Promise<void>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export interface SearchParams {
  index: string;
  query: SearchQuery;
  size?: number;
  from?: number;
  sort?: SortOption[];
  trackTotalHits?: boolean;
  /** Metric aggregations (e.g. from `compileToOpenSearch`). */
  aggs?: Record<string, unknown>;
  /**
   * Source filtering: only these document fields are returned
   * (e.g. from `compileToOpenSearch`, which projects requested axes).
   * When omitted, OpenSearch returns the full `_source`.
   */
  _source?: string[];
}

export interface SearchQuery {
  bool?: BoolQuery;
  /** Object form `{ query, operator? }` or shorthand plain-text form. */
  match?: Record<string, MatchQuery | string>;
  matchAll?: Record<string, never>;
  knn?: KNNInput;
}

export interface BoolQuery {
  must?: SearchQuery[];
  should?: SearchQuery[];
  filter?: SearchQuery[];
  mustNot?: SearchQuery[];
  minimum_should_match?: number | string;
}

export interface MatchQuery {
  query: string;
  operator?: "and" | "or";
  fuzziness?: string | number;
}

export interface KNNQuery {
  field: string;
  vector: number[];
  k: number;
  numCandidates?: number;
  /** Filter applied inside the k-NN clause (tenant isolation). */
  filter?: SearchQuery;
}

/**
 * Single-clause form (`{ field, vector, k }`) or the already-compiled
 * map form (`{ [field]: { vector, k, filter? } }`) emitted by
 * `compileToOpenSearch`. The adapter accepts both.
 */
export type KNNInput = KNNQuery | Record<string, unknown>;

export interface SortOption {
  [field: string]: { order: "asc" | "desc" } | string;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number | { value: number; relation: "eq" | "gte" };
  took: number;
  timedOut: boolean;
  /** Raw aggregation results keyed by agg name (present when requested). */
  aggregations?: Record<string, unknown>;
}

export interface SearchHit {
  _index: string;
  _id: string;
  _score?: number;
  _source: Record<string, unknown>;
  sort?: unknown[];
}

export interface IndexParams {
  index: string;
  id: string;
  document: Record<string, unknown>;
  refresh?: boolean;
}

export interface SearchIndexResult {
  _index: string;
  _id: string;
  _version: number;
  result: "created" | "updated" | "noop";
}

export interface OpenSearchConfig extends SearchConfig {
  url: string;
  username?: string;
  password?: string;
  indexPrefix?: string;
  ssl?: {
    rejectUnauthorized?: boolean;
    ca?: string;
  };
  /**
   * Pre-built client (tests, shared connections).
   * The adapter never closes an injected client.
   */
  client?: import("@opensearch-project/opensearch").Client;
}