export enum ExecutionTarget {
  POSTGRESQL = "postgresql",
  OPENSEARCH = "opensearch",
  S3_STATISTICS = "s3_statistics",
  /** S3 JSON source data + Axis query execution (Architecture C JSON). */
  S3_JSON = "s3_json",
  /** S3 Parquet source data + Axis query execution (Architecture C Parquet). */
  S3_PARQUET = "s3_parquet",
}

/**
 * Datasource name selected per request (middleware `X-Axis-Target`).
 * Logical names — the semantic layer is identical, only the physical
 * datasource implementation differs.
 */
export type DataSourceName = "opensearch" | "s3-json" | "s3-parquet";

export const DATA_SOURCE_NAMES: readonly DataSourceName[] = [
  "opensearch",
  "s3-json",
  "s3-parquet",
] as const;

export function executionTargetForDataSource(name: DataSourceName): ExecutionTarget {
  switch (name) {
    case "opensearch":
      return ExecutionTarget.OPENSEARCH;
    case "s3-json":
      return ExecutionTarget.S3_JSON;
    case "s3-parquet":
      return ExecutionTarget.S3_PARQUET;
  }
}

export interface PlannerConfig {
  enabled?: boolean;
  planner?: QueryPlanner | "default" | string;
  rules?: PlanningRule[];
  defaultTarget?: ExecutionTarget;
}

export interface QueryPlanner {
  plan(query: PlanInput, context: PlanContext): Promise<ExecutionPlan>;
}

export interface PlanInput {
  model: string;
  axes?: string[];
  metrics?: string[];
  filters?: PlanFilter[];
  orderBy?: PlanOrderBy[];
  search?: PlanSearch;
  limit?: number;
  offset?: number;
}

export interface PlanFilter {
  field: string;
  operator: string;
  value?: unknown;
}

export interface PlanOrderBy {
  field: string;
  direction: "asc" | "desc";
}

export interface PlanSearch {
  type: "semantic" | "fulltext" | "hybrid";
  text: string;
  vector?: number[];
  fields?: string[];
}

/**
 * Architecture name selected per request (middleware `X-Axis-Target`).
 *
 * Generic string — the library never hardcodes architecture names.
 * Concrete architectures ("A", "A2", "C", ...) are defined and mapped
 * to datasources by the middleware/application.
 */
export type ArchitectureName = string;

export interface PlanContext {
  security?: Record<string, unknown>;
  tenant?: string;
  user?: string;
  /**
   * Explicit datasource request (e.g. from middleware `X-Axis-Target`).
   * When set, the planner routes to it instead of the default rules.
   */
  datasource?: DataSourceName;
  /**
   * Logical architecture label for tracing (e.g. "A", "A2", "C").
   * Informational only — routing uses `datasource`. Defined by the
   * middleware, never interpreted by the library.
   */
  architecture?: ArchitectureName;
}

export interface ExecutionPlan {
  target: ExecutionTarget;
  reason: string;
  estimatedCost?: number;
  fallback?: ExecutionTarget[];
  /** Echo of `PlanContext.architecture` when provided. */
  architecture?: ArchitectureName;
}

export interface PlanningRule {
  name: string;
  priority: number;
  condition: (input: PlanInput, context: PlanContext) => boolean;
  target: ExecutionTarget;
  fallback?: ExecutionTarget[];
}

export interface DefaultPlannerConfig extends PlannerConfig {
  planner: "default";
  rules?: PlanningRule[];
}