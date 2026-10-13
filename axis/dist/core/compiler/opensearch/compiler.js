import { CompilationError } from "../errors.js";
export function compileToOpenSearch(query, options = {}) {
    if (query.joins.length > 0) {
        throw new CompilationError(`Model "${query.model.name}" query spans ${query.joins.length + 1} models, which single-index compilation cannot express. ` +
            `Execute it via Axis.searchDocuments() (joined in-memory execution) instead of compiling it directly.`);
    }
    const rawIndex = query.model.search?.index ?? query.model.name;
    if (typeof rawIndex !== "string" || rawIndex.length === 0) {
        throw new CompilationError(`Model "${query.model.name}" has an invalid search index.`);
    }
    const index = rawIndex;
    const securityFilters = options.securityFilters ?? [];
    const dsl = query.search !== undefined
        ? buildSearchDSL(query, securityFilters, options.queryVector)
        : buildDSL(query, securityFilters);
    return {
        index,
        body: dsl,
    };
}
export function searchFieldForAxis(axis) {
    // Bare field within the owning model — identical to the display name for
    // root-model axes, and the correct indexed key for joined-model axes
    // (whose display name is the dotted `Model.field` ref).
    const field = axis.definition.search?.field ?? axis.field;
    if (typeof field !== "string" || field.length === 0) {
        throw new CompilationError(`Axis "${axis.name}" has an invalid search field.`);
    }
    return field;
}
export function searchFieldForMetric(metric) {
    const field = metric.definition.search?.field ?? metric.definition.sql ?? "_id";
    if (typeof field !== "string" || field.length === 0) {
        throw new CompilationError(`Metric "${metric.name}" has an invalid search field.`);
    }
    return field;
}
function buildDSL(query, securityFilters = []) {
    const dsl = {
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
            let nested = metricAggs;
            for (let i = query.axes.length - 1; i >= 0; i--) {
                const axis = query.axes[i];
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
function searchFieldForFilter(query, field) {
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
function exactIndexedField(query, field) {
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
function exactMatchField(query, field, op) {
    if (op === "equals" ||
        op === "notEquals" ||
        op === "in" ||
        op === "notIn") {
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
function buildSearchDSL(query, securityFilters, queryVector) {
    const search = query.search;
    if (search === undefined) {
        throw new CompilationError("Search DSL requires a search node.");
    }
    const searchType = search.node.searchType;
    const filterClauses = collectFilterClauses(query, securityFilters);
    const dsl = {
        query: { match_all: {} },
        size: query.limit,
        from: query.offset,
    };
    if (query.axes.length > 0) {
        dsl._source = query.axes.map((axis) => searchFieldForAxis(axis));
    }
    const needsVector = searchType === "semantic" || searchType === "hybrid";
    if (needsVector && queryVector === undefined) {
        throw new CompilationError(`Search type "${searchType}" requires a query vector. ` +
            `Use axis.search() so the embedding provider generates one.`);
    }
    if (searchType === "semantic") {
        dsl.query = {
            knn: {
                [embeddingFieldOf(query)]: {
                    // Guarded above: semantic always has a vector here.
                    vector: queryVector,
                    k: search.node.k ?? query.limit,
                    ...(filterClauses.length > 0
                        ? { filter: { bool: { filter: filterClauses } } }
                        : {}),
                },
            },
        };
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
                            vector: queryVector,
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
function embeddingFieldOf(query) {
    const field = query.model.search?.embeddingField ?? "embedding";
    if (typeof field !== "string" || field.length === 0) {
        throw new CompilationError(`Model "${query.model.name}" has an invalid embedding field.`);
    }
    return field;
}
function searchTextFields(query, fields) {
    const names = fields ??
        query.model.search?.searchable ??
        query.model.search?.embeddingInput ??
        [];
    if (names.length > 0) {
        return names.map((name) => query.model.axes[name]?.search?.field ?? name);
    }
    return Object.entries(query.model.axes)
        .filter(([, axis]) => axis.type === "string")
        .map(([name, axis]) => axis.search?.field ?? name);
}
function buildTextMatches(query, text, fields) {
    return searchTextFields(query, fields).map((field) => ({
        match: { [field]: text },
    }));
}
function collectFilterClauses(query, securityFilters) {
    // NOTE: only user-requested filters + security go here. Metric-level
    // canned filters are compiled per-metric as `filter` sub-aggs (see
    // compileMetricAgg) so combining metrics never intersects them.
    const filterClauses = [...securityFilters];
    for (const filter of query.filters) {
        const compiled = compileResolvedFilter(query, filter);
        if (compiled) {
            filterClauses.push(compiled);
        }
    }
    return filterClauses;
}
function buildBoolQuery(query, securityFilters = []) {
    const bool = {};
    const mustClauses = [];
    const filterClauses = collectFilterClauses(query, securityFilters);
    if (mustClauses.length > 0) {
        bool.must = mustClauses;
    }
    if (filterClauses.length > 0) {
        bool.filter = filterClauses;
    }
    return { bool };
}
function compileResolvedFilter(query, filter) {
    return compileFilter(query, filter.node);
}
function compileFilter(query, filter) {
    const op = filter.operator;
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
            throw new CompilationError(`Unsupported filter operator "${op}" for OpenSearch compilation.`);
    }
}
function buildSort(query) {
    return query.orderBy.map((order) => {
        const field = exactIndexedField(query, order.field.name);
        return {
            [field]: { order: order.node.direction },
        };
    });
}
function buildMetricAggs(query) {
    const aggs = {};
    for (const metric of query.metrics) {
        const agg = compileMetricAgg(query, metric);
        if (agg) {
            aggs[metric.name] = agg;
        }
    }
    return aggs;
}
function compileMetricAgg(query, metric) {
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
    const clauses = [];
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
function compileBareMetricAgg(metricName, def, searchField) {
    switch (def.type) {
        case "count": {
            return { value_count: { field: searchField } };
        }
        case "sum": {
            if (!def.sql && !def.search?.field) {
                throw new CompilationError(`Metric "${metricName}" requires sql for sum aggregation.`);
            }
            return { sum: { field: searchField } };
        }
        case "avg": {
            if (!def.sql && !def.search?.field) {
                throw new CompilationError(`Metric "${metricName}" requires sql for avg aggregation.`);
            }
            return { avg: { field: searchField } };
        }
        case "min": {
            if (!def.sql && !def.search?.field) {
                throw new CompilationError(`Metric "${metricName}" requires sql for min aggregation.`);
            }
            return { min: { field: searchField } };
        }
        case "max": {
            if (!def.sql && !def.search?.field) {
                throw new CompilationError(`Metric "${metricName}" requires sql for max aggregation.`);
            }
            return { max: { field: searchField } };
        }
        case "countDistinct": {
            if (!def.sql && !def.search?.field) {
                throw new CompilationError(`Metric "${metricName}" requires sql for countDistinct aggregation.`);
            }
            return { cardinality: { field: searchField } };
        }
        default:
            throw new CompilationError(`Unsupported metric type "${def.type}" for OpenSearch compilation.`);
    }
}
//# sourceMappingURL=compiler.js.map