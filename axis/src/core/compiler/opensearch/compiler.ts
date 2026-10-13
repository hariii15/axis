import type {
  ResolvedQuery,
  ResolvedAxis,
  ResolvedMetric,
  ResolvedFilter,
  ResolvedOrderBy,
} from "../../resolver/type.js";

import type { Filter, FilterOperator } from "../../query/types.js";

import type {
  CompiledOpenSearchQuery,
  OpenSearchDSL,
} from "./types.js";

import { CompilationError } from "../errors.js";

export interface CompileToOpenSearchOptions {
  /**
   * Security term filters (Phase 5), e.g. from
   * `buildOpenSearchSecurityFilters(context, config)`.
   * Prepended to `bool.filter` so tenant isolation applies
   * before any query or metric filters.
   */
  securityFilters?: Record<string, unknown>[];
  /**
   * Query embedding for semantic / hybrid search (Phase 9).
   * Produced by `axis.search()` via the embedding provider —
   * the compiler itself never calls the provider.
   */
  queryVector?: number[];
}

export function compileToOpenSearch(
  query: ResolvedQuery,
  options: CompileToOpenSearchOptions = {},
): CompiledOpenSearchQuery {
  if (query.joins.length > 0) {
    throw new CompilationError(
      `Model "${query.model.name}" query spans ${query.joins.length + 1} models, which single-index compilation cannot express. ` +
        `Execute it via Axis.searchDocuments() (joined in-memory execution) instead of compiling it directly.`,
    );
  }
  const rawIndex = query.model.search?.index ?? query.model.name;
  if (typeof rawIndex !== "string" || rawIndex.length === 0) {
    throw new CompilationError(
      `Model "${query.model.name}" has an invalid search index.`,
    );
  }
  const index = rawIndex;
  const securityFilters = options.securityFilters ?? [];
  const dsl =
    query.search !== undefined
      ? buildSearchDSL(query, securityFilters, options.queryVector)
      : buildDSL(query, securityFilters);

  return {
    index,
    body: dsl,
  };
}

export function searchFieldForAxis(axis: ResolvedAxis): string {
  // Bare field within the owning model — identical to the display name for
  // root-model axes, and the correct indexed key for joined-model axes
  // (whose display name is the dotted `Model.field` ref).
  const field = axis.definition.search?.field ?? axis.field;
  if (typeof field !== "string" || field.length === 0) {
    throw new CompilationError(
      `Axis "${axis.name}" has an invalid search field.`,
    );
  }
  return field;
}

export function searchFieldForMetric(metric: ResolvedMetric): string {
  const field =
    metric.definition.search?.field ?? metric.definition.sql ?? "_id";
  if (typeof field !== "string" || field.length === 0) {
    throw new CompilationError(
      `Metric "${metric.name}" has an invalid search field.`,
    );
  }
  return field;
}

function buildDSL(
  query: ResolvedQuery,
  securityFilters: Record<string, unknown>[] = [],
): OpenSearchDSL {
  const dsl: OpenSearchDSL = {
    query: buildBoolQuery(query, securityFilters),
    size: query.limit,
    from: query.offset,
  };

  if (query.orderBy.length > 0) {
    dsl.sort = buildSort(query);
  }

  if (query.axes.length > 0) {
    dsl._source = query.axes.map((axis) => searchFieldForAxis(axis));
  }

  const metricAggs = buildMetricAggs(query);
  if (Object.keys(metricAggs).length > 0) {
    dsl.aggs = metricAggs;
    if (query.axes.length > 0) {
      // Nested terms chain (axis0 -> axis1 -> ... -> metrics): the true
      // multi-column GROUP BY equivalent. Single-axis queries produce
      // exactly the previous shape (`<axis>_terms` at top level).
      let nested: Record<string, unknown> = metricAggs;
      for (let i = query.axes.length - 1; i >= 0; i--) {
        const axis = query.axes[i] as ResolvedAxis;
        const termsField = exactIndexedField(query, axis.name);
        nested = {
          [`${axis.name}_terms`]: {
            terms: { field: termsField, size: query.limit },
            aggs: nested,
          },
        };
      }
      dsl.aggs = {
        ...dsl.aggs,
        ...nested,
      };
    }
  }

  return dsl;
}

function searchFieldForFilter(query: ResolvedQuery, field: string): string {
  const axis = query.model.axes[field];
  const mapped = axis?.search?.field ?? field;
  if (typeof mapped !== "string" || mapped.length === 0) {
    throw new CompilationError(`Invalid search field "${field}".`);
  }
  return mapped;
}

/**
 * Resolve the indexed field for an exact operation (term filter, sort,
 * terms aggregation) on a model axis.
 *
 * String axes indexed as analyzed `text` need the `.keyword` subfield;
 * axes declared `search.exact` (indexed as `keyword`) are used as-is —
 * querying `<field>.keyword` there would hit a nonexistent field and
 * silently match nothing.
 */
function exactIndexedField(query: ResolvedQuery, field: string): string {
  const axis = query.model.axes[field];
  const base = searchFieldForFilter(query, field);
  if (axis?.type === "string" && axis?.search?.exact !== true) {
    return `${base}.keyword`;
  }
  return base;
}

/**
 * Exact-match operators (equals/notEquals/in/notIn) on string axes
 * target the `.keyword` subfield: `term` queries are not analyzed,
 * so they can never match an analyzed `text` field. Sorting has the
 * same requirement (fielddata is disabled on text fields).
 */
function exactMatchField(
  query: ResolvedQuery,
  field: string,
  op: FilterOperator,
): string {
  if (
    op === "equals" ||
    op === "notEquals" ||
    op === "in" ||
    op === "notIn"
  ) {
    return exactIndexedField(query, field);
  }
  return searchFieldForFilter(query, field);
}

/**
 * Search-oriented DSL (Phase 9): returns documents, not aggregations.
 *
 * Shapes match the OpenSearch k-NN plugin (`query.knn.<field>`):
 * - semantic: `query.knn` on the model embedding field (requires
 *   `queryVector`; filters/security ride inside `knn.filter`).
 * - fulltext: `bool.should` match clauses over the searchable fields.
 * - hybrid: `bool.must` knn plus `bool.should` text matches.
 */
function buildSearchDSL(
  query: ResolvedQuery,
  securityFilters: Record<string, unknown>[],
  queryVector: number[] | undefined,
): OpenSearchDSL {
  const search = query.search;
  if (search === undefined) {
    throw new CompilationError("Search DSL requires a search node.");
  }
  const searchType = search.node.searchType;
  const filterClauses = collectFilterClauses(query, securityFilters);

  const dsl: OpenSearchDSL = {
    query: { match_all: {} },
    size: query.limit,
    from: query.offset,
  };

  if (query.axes.length > 0) {
    dsl._source = query.axes.map((axis) => searchFieldForAxis(axis));
  }

  const needsVector = searchType === "semantic" || searchType === "hybrid";
  if (needsVector && queryVector === undefined) {
    throw new CompilationError(
      `Search type "${searchType}" requires a query vector. ` +
        `Use axis.search() so the embedding provider generates one.`,
    );
  }

  if (searchType === "semantic") {
    dsl.query = {
      knn: {
        [embeddingFieldOf(query)]: {
          // Guarded above: semantic always has a vector here.
          vector: queryVector as number[],
          k: search.node.k ?? query.limit,
          ...(filterClauses.length > 0
            ? { filter: { bool: { filter: filterClauses } } }
            : {}),
        },
      },
    }
    return dsl;
  }

  const textClauses = buildTextMatches(query, search.node.text, search.node.fields);

  if (searchType === "fulltext") {
    dsl.query = {
      bool: {
        ...(filterClauses.length > 0 ? { filter: filterClauses } : {}),
        // minimum_should_match: with a filter present OpenSearch would
        // otherwise treat `should` as optional scoring only, and the
        // search text would never narrow the result set.
        ...(textClauses.length > 0
          ? { should: textClauses, minimum_should_match: 1 }
          : {}),
      },
    };
    if (query.orderBy.length > 0) {
      dsl.sort = buildSort(query);
    }
    return dsl;
  }

  // hybrid: knn scored in must, text matches in should, filters guard both.
  dsl.query = {
    bool: {
      must: [
        {
          knn: {
            [embeddingFieldOf(query)]: {
              // Guarded above: hybrid always has a vector here.
              vector: queryVector as number[],
              k: search.node.k ?? query.limit,
              ...(filterClauses.length > 0
                ? { filter: { bool: { filter: filterClauses } } }
                : {}),
            },
          },
        },
      ],
      ...(filterClauses.length > 0 ? { filter: filterClauses } : {}),
      ...(textClauses.length > 0 ? { should: textClauses } : {}),
    },
  };
  return dsl;
}

function embeddingFieldOf(query: ResolvedQuery): string {
  const field = query.model.search?.embeddingField ?? "embedding";
  if (typeof field !== "string" || field.length === 0) {
    throw new CompilationError(
      `Model "${query.model.name}" has an invalid embedding field.`,
    );
  }
  return field;
}

function searchTextFields(
  query: ResolvedQuery,
  fields?: string[],
): string[] {
  const names =
    fields ??
    query.model.search?.searchable ??
    query.model.search?.embeddingInput ??
    [];
  if (names.length > 0) {
    return names.map(
      (name) => query.model.axes[name]?.search?.field ?? name,
    );
  }
  return Object.entries(query.model.axes)
    .filter(([, axis]) => axis.type === "string")
    .map(([name, axis]) => axis.search?.field ?? name);
}

function buildTextMatches(
  query: ResolvedQuery,
  text: string,
  fields?: string[],
): Record<string, unknown>[] {
  return searchTextFields(query, fields).map((field) => ({
    match: { [field]: text },
  }));
}

function collectFilterClauses(
  query: ResolvedQuery,
  securityFilters: Record<string, unknown>[],
): Record<string, unknown>[] {
  // NOTE: only user-requested filters + security go here. Metric-level
  // canned filters are compiled per-metric as `filter` sub-aggs (see
  // compileMetricAgg) so combining metrics never intersects them.
  const filterClauses: Record<string, unknown>[] = [...securityFilters];

  for (const filter of query.filters) {
    const compiled = compileResolvedFilter(query, filter);
    if (compiled) {
      filterClauses.push(compiled);
    }
  }

  return filterClauses;
}

function buildBoolQuery(
  query: ResolvedQuery,
  securityFilters: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const bool: Record<string, unknown> = {};
  const mustClauses: Record<string, unknown>[] = [];
  const filterClauses = collectFilterClauses(query, securityFilters);

  if (mustClauses.length > 0) {
    bool.must = mustClauses;
  }
  if (filterClauses.length > 0) {
    bool.filter = filterClauses;
  }

  return { bool };
}

function compileResolvedFilter(
  query: ResolvedQuery,
  filter: ResolvedFilter,
): Record<string, unknown> | null {
  return compileFilter(query, filter.node as Filter);
}

function compileFilter(
  query: ResolvedQuery,
  filter: Filter,
): Record<string, unknown> | null {
  const op = filter.operator as FilterOperator;
  const field = exactMatchField(query, filter.field, op);
  const value = filter.value;

  switch (op) {
    case "equals":
      return { term: { [field]: value } };
    case "notEquals":
      return { bool: { must_not: { term: { [field]: value } } } };
    case "greaterThan":
      return { range: { [field]: { gt: value } } };
    case "greaterThanOrEqual":
      return { range: { [field]: { gte: value } } };
    case "lessThan":
      return { range: { [field]: { lt: value } } };
    case "lessThanOrEqual":
      return { range: { [field]: { lte: value } } };
    case "contains":
      return { match: { [field]: value } };
    case "startsWith":
      return { prefix: { [field]: value } };
    case "endsWith":
      return { wildcard: { [field]: `*${value}` } };
    case "in":
      return { terms: { [field]: value } };
    case "notIn":
      return { bool: { must_not: { terms: { [field]: value } } } };
    case "isNull":
      return { bool: { must_not: { exists: { field } } } };
    case "isNotNull":
      return { exists: { field } };
    default:
      throw new CompilationError(
        `Unsupported filter operator "${op}" for OpenSearch compilation.`,
      );
  }
}

function buildSort(query: ResolvedQuery): Record<string, unknown>[] {
  return query.orderBy.map((order) => {
    const field = exactIndexedField(query, order.field.name);
    return {
      [field]: { order: order.node.direction },
    };
  });
}

function buildMetricAggs(query: ResolvedQuery): Record<string, unknown> {
  const aggs: Record<string, unknown> = {};

  for (const metric of query.metrics) {
    const agg = compileMetricAgg(query, metric);
    if (agg) {
      aggs[metric.name] = agg;
    }
  }

  return aggs;
}

function compileMetricAgg(
  query: ResolvedQuery,
  metric: ResolvedMetric,
): Record<string, unknown> | null {
  const def = metric.definition;
  const searchField = searchFieldForMetric(metric);

  const metricAgg = compileBareMetricAgg(metric.name, def, searchField);
  if (metricAgg === null) {
    return null;
  }

  // Canned metric filters scope ONLY this metric via a `filter` sub-agg.
  // They must not leak into the shared bool: combining two filtered
  // metrics (e.g. micro + small) would otherwise intersect to nothing.
  const canned = def.filters ?? [];
  if (canned.length === 0) {
    return metricAgg;
  }
  const clauses: Record<string, unknown>[] = [];
  for (const filter of canned) {
    const compiled = compileFilter(query, filter);
    if (compiled) {
      clauses.push(compiled);
    }
  }
  return {
    filter: { bool: { filter: clauses } },
    aggs: { value: metricAgg },
  };
}

function compileBareMetricAgg(
  metricName: string,
  def: ResolvedMetric["definition"],
  searchField: string,
): Record<string, unknown> | null {
  switch (def.type) {
    case "count": {
      return { value_count: { field: searchField } };
    }
    case "sum": {
      if (!def.sql && !def.search?.field) {
        throw new CompilationError(
          `Metric "${metricName}" requires sql for sum aggregation.`,
        );
      }
      return { sum: { field: searchField } };
    }
    case "avg": {
      if (!def.sql && !def.search?.field) {
        throw new CompilationError(
          `Metric "${metricName}" requires sql for avg aggregation.`,
        );
      }
      return { avg: { field: searchField } };
    }
    case "min": {
      if (!def.sql && !def.search?.field) {
        throw new CompilationError(
          `Metric "${metricName}" requires sql for min aggregation.`,
        );
      }
      return { min: { field: searchField } };
    }
    case "max": {
      if (!def.sql && !def.search?.field) {
        throw new CompilationError(
          `Metric "${metricName}" requires sql for max aggregation.`,
        );
      }
      return { max: { field: searchField } };
    }
    case "countDistinct": {
      if (!def.sql && !def.search?.field) {
        throw new CompilationError(
          `Metric "${metricName}" requires sql for countDistinct aggregation.`,
        );
      }
      return { cardinality: { field: searchField } };
    }
    default:
      throw new CompilationError(
        `Unsupported metric type "${def.type}" for OpenSearch compilation.`,
      );
  }
}
