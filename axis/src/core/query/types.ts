export interface AxisQuery {
  model: string;

  axes?: string[];

  metrics?: string[];

  filters?: Filter[];

  orderBy?: OrderBy[];

  limit?: number;

  offset?: number;

  /**
   * Semantic / full-text search (Phase 9). Executed against
   * OpenSearch via `axis.search()` — the PostgreSQL path ignores it.
   */
  search?: SearchInput;

  /**
   * Per-query cache TTL in **milliseconds**. Overrides the
   * `CacheManager` default for this query only. Never part of
   * the cache key — identical queries with different TTLs
   * share one entry.
   */
  cacheTtl?: number;
}

export interface Filter {
  field: string;

  operator: FilterOperator;

  value?: FilterValue;
}

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];

export interface OrderBy {
  field: string;

  direction: "asc" | "desc";
}

export type SearchType = "semantic" | "fulltext" | "hybrid";

export interface SearchInput {
  type: SearchType;

  text: string;

  /**
   * Axis names to search (full-text / hybrid). Defaults to the
   * model's `search.searchable` axes.
   */
  fields?: string[];

  /**
   * Number of nearest neighbors for vector search.
   * Defaults to the query limit.
   */
  k?: number;
}