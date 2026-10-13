import type {
  Filter,
  FilterOperator,
  FilterValue,
} from "../core/query/types.js";

export type ModelSource =
  | {
      type: "table";
      table: string;
    }
  | {
      type: "sql";
      sql: string;
    }
  | {
      type: "function";
      name: string;
      args?: string[];
    };

export type AxisType =
  | "string"
  | "number"
  | "boolean"
  | "time";

export interface AxisDefinition {
  sql: string;
  type: AxisType;
  primaryKey?: boolean;
  description?: string;
  search?: AxisSearchDefinition;
}

export interface AxisSearchDefinition {
  /** OpenSearch field name. Defaults to axis name. */
  field?: string;
  /** Whether field is full-text searchable. Defaults to true for string axes. */
  searchable?: boolean;
  /**
   * Indexed as an exact `keyword` (not analyzed `text`): exact-match
   * filters, sorts and terms aggregations use the field as-is instead
   * of appending the `.keyword` subfield (which only exists on
   * multi-field `text` mappings). @default false
   */
  exact?: boolean;
}

export type MetricType =
  | "count"
  | "countDistinct"
  | "sum"
  | "avg"
  | "min"
  | "max";

export interface MetricDefinition {
  type: MetricType;

  /**
   * SQL expression used by the metric.
   *
   * For count, this can be omitted to count rows.
   */
  sql?: string;

  /**
   * Filters that are always applied when
   * this metric is calculated.
   */
  filters?: Filter[];

  description?: string;

  search?: MetricSearchDefinition;
}

export interface MetricSearchDefinition {
  /** OpenSearch field backing sum/avg/min/max/value_count. Defaults to metric sql. */
  field?: string;
}

export interface ModelSecurity {
  /**
   * SQL expression/function used to restrict
   * rows according to the current context.
   */
  sql?: string;

  /**
   * PostgreSQL function used for row-level security.
   */
  function?: {
    name: string;
    args: string[];
  };

  /**
   * OpenSearch scoping for this model.
   *
   * `{ shared: true }` marks shared/global catalog data (no tenant
   * column): engine security term filters are NOT applied to this
   * model's OpenSearch queries. Authentication is still enforced —
   * only the tenant/user term filters are skipped.
   */
  openSearch?: {
    shared?: boolean;
  };
}

export interface ModelSearchDefinition {
  /** OpenSearch index name. Defaults to model name when omitted. */
  index: string;
  /** Axis names used for full-text / semantic search. Informational for now. */
  searchable?: string[];
  /** Axis names combined into embedding input text (e.g. ["title","description"]). */
  embeddingInput?: string[];
  /** Vector field name in OpenSearch. @default "embedding" */
  embeddingField?: string;
}

export interface ModelDefinition {
  name: string;

  source: ModelSource;

  /**
   * Logical dataset key (e.g. "companyinfo").
   *
   * Physical datasources (OpenSearch index, S3 prefix) bind to this
   * key — never to the model name directly — so the same semantic
   * model can be benchmarked across architectures. When omitted,
   * the lowercased model name is used.
   */
  dataset?: string;

  axes: Record<string, AxisDefinition>;

  metrics: Record<string, MetricDefinition>;

  security?: ModelSecurity;

  search?: ModelSearchDefinition;

  description?: string;
}