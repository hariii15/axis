import type {
  AxisQuery,
} from "../core/query/types.js";

import {
  DEFAULT_LIMIT,
} from "../core/query/schema.js";

import type {
  QueryAST,
} from "./types.js";

import {
  createAxisNode,
  createMetricNode,
  createFilterNode,
  createOrderByNode,
  createSearchNode,
} from "./nodes.js";


/**
 * Converts a validated AxisQuery into the
 * internal QueryAST representation.
 *
 * IMPORTANT:
 *
 * This function assumes that the query has already
 * passed runtime validation.
 *
 * It does not:
 * - validate models
 * - resolve axes
 * - resolve metrics
 * - generate SQL
 * - execute queries
 * - access the database
 */
export function buildQueryAST(
  query: AxisQuery,
): QueryAST {

  const axes =
    query.axes?.map((axis) =>
      createAxisNode(axis),
    ) ?? [];

  const metrics =
    query.metrics?.map((metric) =>
      createMetricNode(metric),
    ) ?? [];

  const filters =
    query.filters?.map((filter) =>
      createFilterNode(
        filter.field,
        filter.operator,
        filter.value,
      ),
    ) ?? [];

  const orderBy =
    query.orderBy?.map((order) =>
      createOrderByNode(
        order.field,
        order.direction,
      ),
    ) ?? [];

  return {
    model: query.model,

    axes,

    metrics,

    filters,

    orderBy,

    ...(query.search !== undefined
      ? {
          search: createSearchNode(
            query.search.type,
            query.search.text,
            query.search.fields,
            query.search.k,
          ),
        }
      : {}),

    limit:
      query.limit ?? DEFAULT_LIMIT,

    offset:
      query.offset ?? 0,
  };
}