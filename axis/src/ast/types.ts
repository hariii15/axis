import type {
  FilterValue,
  FilterOperator,
  SearchType,
} from "../core/query/types.js";

export interface QueryAST {
  /**
   * Name of the Model that will execute the query.
   */
  model: string;

  /**
   * Fields used to group/break down the result.
   */
  axes: AxisNode[];

  /**
   * Aggregated values requested by the query.
   */
  metrics: MetricNode[];

  /**
   * Query filtering conditions.
   */
  filters: FilterNode[];

  /**
   * Sorting instructions.
   */
  orderBy: OrderByNode[];

  /**
   * Maximum number of rows returned.
   */
  limit: number;

  /**
   * Number of rows skipped.
   */
  offset: number;

  /**
   * Semantic / full-text search (Phase 9). Absent for
   * pure structured queries.
   */
  search?: SearchNode;
}


/**
 * Represents an Axis selected by the query.
 *
 * Example:
 *
 * axes: ["department"]
 *
 * becomes:
 *
 * {
 *   type: "axis",
 *   name: "department"
 * }
 */
export interface AxisNode {
  type: "axis";

  /**
   * Name of the axis as defined by the Model.
   */
  name: string;
}


/**
 * Represents a Metric selected by the query.
 *
 * Example:
 *
 * metrics: ["pendingCount"]
 *
 * becomes:
 *
 * {
 *   type: "metric",
 *   name: "pendingCount"
 * }
 */
export interface MetricNode {
  type: "metric";

  /**
   * Name of the metric as defined by the Model.
   */
  name: string;
}


/**
 * Represents a filtering condition.
 *
 * Example:
 *
 * {
 *   field: "status",
 *   operator: "equals",
 *   value: 1
 * }
 */
export interface FilterNode {
  type: "filter";

  /**
   * Field being filtered.
   *
   * At this stage this is only the semantic name.
   * The Model Resolver will later determine whether
   * this refers to an axis, metric, or model field.
   */
  field: string;

  /**
   * Comparison operator.
   */
  operator: FilterOperator;

  /**
   * Value used by the comparison.
   */
  value?: FilterValue;
}


/**
 * Represents a semantic / full-text search request.
 *
 * Example:
 *
 * {
 *   type: "semantic",
 *   text: "ML infrastructure"
 * }
 */
export interface SearchNode {
  type: "search";

  searchType: SearchType;

  text: string;

  fields?: string[];

  k?: number;
}


/**
 * Represents a sorting instruction.
 *
 * Example:
 *
 * {
 *   field: "pendingCount",
 *   direction: "desc"
 * }
 */
export interface OrderByNode {
  type: "orderBy";

  /**
   * Field being used for sorting.
   */
  field: string;

  /**
   * Sort direction.
   */
  direction: "asc" | "desc";
}