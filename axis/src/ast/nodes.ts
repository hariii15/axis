import type {
  FilterValue,
  FilterOperator,
  SearchType,
} from "../core/query/types.js";

import type {
  AxisNode,
  MetricNode,
  FilterNode,
  OrderByNode,
  SearchNode,
} from "./types.js";


/**
 * Creates an Axis AST node.
 */
export function createAxisNode(
  name: string,
): AxisNode {
  return {
    type: "axis",
    name,
  };
}


/**
 * Creates a Metric AST node.
 */
export function createMetricNode(
  name: string,
): MetricNode {
  return {
    type: "metric",
    name,
  };
}


/**
 * Creates a Filter AST node.
 */
export function createFilterNode(
  field: string,
  operator: FilterOperator,
  value?: FilterValue,
): FilterNode {
  return {
    type: "filter",
    field,
    operator,
    ...(value !== undefined ? { value } : {}),
  };
}


/**
 * Creates a Search AST node.
 */
export function createSearchNode(
  searchType: SearchType,
  text: string,
  fields?: string[],
  k?: number,
): SearchNode {
  return {
    type: "search",
    searchType,
    text,
    ...(fields !== undefined ? { fields } : {}),
    ...(k !== undefined ? { k } : {}),
  };
}


/**
 * Creates an OrderBy AST node.
 */
export function createOrderByNode(
  field: string,
  direction: "asc" | "desc",
): OrderByNode {
  return {
    type: "orderBy",
    field,
    direction,
  };
}