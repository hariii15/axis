/**
 * Multi-model OpenSearch execution (joined path).
 *
 * The single-index compiler (`compileToOpenSearch`) only understands the
 * root model: joined refs (`ContactInfo.email`) would target nonexistent
 * fields and silently match nothing. This module executes resolved queries
 * with `joins.length > 0` generically instead:
 *
 *   1. Fetch candidate documents per involved model (root fetch honors
 *      full-text/semantic search + security filters; joined models fetch
 *      everything up to `JOINED_FETCH_CAP`).
 *   2. LEFT JOIN in memory along the resolved `JoinStep`s (key equality,
 *      1:N fan-out; unmatched roots are kept with empty joined slots).
 *   3. Apply ALL user filters in memory (uniform semantics on every model;
 *      avoids compiling filters per index dialect).
 *   4. Project document rows (root `_source` bare + requested joined axes
 *      under display names) or compute grouped metrics in memory.
 *   5. Sort (`orderBy`), then paginate (`limit`/`offset`).
 *
 * Nothing here names a concrete model, index, or datasource — models,
 * keys, and display names all come from the `ResolvedQuery`.
 */
import { ExecutionError } from "../executor/errors.js";
/**
 * Per-model document cap for in-memory joining. A2-scale datasets
 * (thousands of docs) fit comfortably; larger totals fail closed with a
 * clear error instead of silently truncating the join.
 */
export const JOINED_FETCH_CAP = 10000;
export async function searchJoinedDocuments(resolved, search, options = {}) {
    const root = resolved.rootModel;
    const models = [root, ...resolved.joinedModels];
    const fetched = new Map();
    for (const model of models) {
        fetched.set(model.name, await fetchModelDocs(resolved, model, search, options));
    }
    const joined = joinRows(resolved, fetched);
    const filtered = joined.filter((row) => resolved.filters.every((filter) => matchesResolvedFilter(row, resolved, filter)));
    if (resolved.metrics.length === 0) {
        const rows = filtered.map((row) => projectDocumentRow(resolved, row));
        sortRows(rows, resolved);
        const rowCount = rows.length;
        return { rows: rows.slice(resolved.offset, resolved.offset + resolved.limit), rowCount };
    }
    const rows = aggregateJoinedRows(resolved, filtered);
    sortRows(rows, resolved);
    const rowCount = rows.length;
    return { rows: rows.slice(resolved.offset, resolved.offset + resolved.limit), rowCount };
}
// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
async function fetchModelDocs(resolved, model, search, options) {
    const index = model.search?.index ?? model.name;
    const isRoot = model.name === resolved.rootModel.name;
    let query;
    let size = JOINED_FETCH_CAP;
    if (isRoot && resolved.search !== undefined) {
        const searchType = resolved.search.node.searchType;
        if (searchType === "semantic" || searchType === "hybrid") {
            if (options.queryVector === undefined) {
                throw new ExecutionError(`Search type "${searchType}" requires an embedding provider: pass embeddings.instance to Axis.`);
            }
            const embeddingField = model.search?.embeddingField ?? "embedding";
            const securityFilters = options.securityFilters ?? [];
            const knnClause = {
                vector: options.queryVector,
                k: resolved.search.node.k ?? resolved.limit,
                ...(securityFilters.length > 0
                    ? { filter: { bool: { filter: securityFilters } } }
                    : {}),
            };
            query =
                searchType === "semantic"
                    ? ({ knn: { [embeddingField]: knnClause } })
                    : {
                        bool: {
                            must: [{ knn: { [embeddingField]: knnClause } }],
                            ...(securityFilters.length > 0
                                ? { filter: securityFilters }
                                : {}),
                        },
                    };
            size = resolved.search.node.k ?? resolved.limit;
        }
        else {
            // fulltext: text matches narrow the root candidates; user filters
            // apply later in memory so joined-model filters stay uniform.
            const textClauses = searchTextMatches(resolved, model);
            const securityFilters = options.securityFilters ?? [];
            query = {
                bool: {
                    ...(textClauses.length > 0
                        ? { should: textClauses, minimum_should_match: 1 }
                        : {}),
                    ...(securityFilters.length > 0
                        ? { filter: securityFilters }
                        : {}),
                },
            };
            if (textClauses.length === 0 && securityFilters.length === 0) {
                query = { matchAll: {} };
            }
        }
    }
    else if (isRoot && (options.securityFilters ?? []).length > 0) {
        query = { bool: { filter: options.securityFilters } };
    }
    else {
        query = { matchAll: {} };
    }
    let result;
    try {
        result = await search.search({
            index,
            query,
            size,
            trackTotalHits: true,
        });
    }
    catch (error) {
        if (error instanceof ExecutionError)
            throw error;
        throw new ExecutionError(`Joined search fetch failed for model "${model.name}" (index "${index}").`, error);
    }
    const total = typeof result.total === "number" ? result.total : result.total.value;
    if (total > result.hits.length && result.hits.length >= size) {
        throw new ExecutionError(`Model "${model.name}" has ${total} matching documents, above the in-memory join cap (${JOINED_FETCH_CAP}). Narrow the query with filters.`);
    }
    return result.hits.map((hit) => ({
        id: hit._id,
        ...(hit._score !== undefined ? { score: hit._score } : {}),
        source: hit._source,
    }));
}
function searchTextMatches(resolved, model) {
    const node = resolved.search?.node;
    if (node === undefined)
        return [];
    const names = node.fields ??
        model.search?.searchable ??
        model.search?.embeddingInput ??
        [];
    const fields = names.length > 0
        ? names.map((name) => indexedKey(model, name))
        : Object.entries(model.axes)
            .filter(([, axis]) => axis.type === "string")
            .map(([name, axis]) => axis.search?.field ?? name);
    return fields.map((field) => ({ match: { [field]: node.text } }));
}
// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
function joinRows(resolved, fetched) {
    const rootName = resolved.rootModel.name;
    const rootDocs = fetched.get(rootName) ?? [];
    let rows = rootDocs.map((doc) => new Map([[rootName, doc]]));
    // Index every joined model's docs by join key once.
    const byKey = new Map();
    const modelByName = new Map([resolved.rootModel, ...resolved.joinedModels].map((m) => [m.name, m]));
    for (const step of resolved.joins) {
        if (!byKey.has(step.to)) {
            const toModel = modelByName.get(step.to);
            const index = new Map();
            for (const doc of fetched.get(step.to) ?? []) {
                const key = keyOf(doc.source, toModel, step.toKey);
                const list = index.get(key) ?? [];
                list.push(doc);
                index.set(key, list);
            }
            byKey.set(step.to, index);
        }
    }
    const pending = [...resolved.joins];
    let progress = true;
    while (pending.length > 0 && progress) {
        progress = false;
        for (let i = pending.length - 1; i >= 0; i--) {
            const step = pending[i];
            // Step applies once every row carries the `from` side.
            if (!rows.every((row) => row.has(step.from)))
                continue;
            const fromModel = modelByName.get(step.from);
            const lookup = byKey.get(step.to) ?? new Map();
            const next = [];
            for (const row of rows) {
                const fromDoc = row.get(step.from);
                const matches = lookup.get(keyOf(fromDoc.source, fromModel, step.fromKey)) ?? [];
                if (matches.length === 0) {
                    // LEFT JOIN: keep the row with an empty joined slot.
                    next.push(row);
                }
                else {
                    for (const match of matches) {
                        // Never overwrite an already-joined model slot (diamond joins
                        // reuse the first consistent match).
                        if (row.has(step.to)) {
                            next.push(row);
                        }
                        else {
                            next.push(new Map([...row, [step.to, match]]));
                        }
                    }
                }
            }
            rows = next;
            pending.splice(i, 1);
            progress = true;
        }
    }
    if (pending.length > 0) {
        throw new ExecutionError(`Cannot order join steps from "${rootName}": unreachable model in join plan.`);
    }
    return rows;
}
/** Join-key comparison with pragmatic number/string tolerance. */
function keyOf(source, model, axisName) {
    const value = source[indexedKey(model, axisName)];
    if (value === null || value === undefined)
        return "\u0000null";
    return `${typeof value}\u0000${String(value)}`;
}
/** Indexed `_source` key for an axis (transformer keys by search field). */
function indexedKey(model, axisName) {
    return model?.axes[axisName]?.search?.field ?? axisName;
}
// ---------------------------------------------------------------------------
// Filters (in-memory, uniform across models)
// ---------------------------------------------------------------------------
function matchesResolvedFilter(row, resolved, filter) {
    const model = modelOf(resolved, filter.model);
    const doc = row.get(filter.model)?.source;
    const value = doc === undefined ? undefined : doc[indexedKey(model, filter.field)];
    return matchesOperator(value, filter.node.operator, filter.node.value);
}
function modelOf(resolved, name) {
    if (resolved.rootModel.name === name)
        return resolved.rootModel;
    return resolved.joinedModels.find((m) => m.name === name);
}
export function matchesOperator(value, operator, expected) {
    switch (operator) {
        case "isNull":
            return value === null || value === undefined;
        case "isNotNull":
            return value !== null && value !== undefined;
        case "equals":
            return looseEquals(value, expected);
        case "notEquals":
            // must_not term semantics: missing values match.
            if (value === null || value === undefined)
                return true;
            return !looseEquals(value, expected);
        case "in":
            if (!Array.isArray(expected))
                return false;
            if (value === null || value === undefined)
                return false;
            return expected.some((item) => looseEquals(value, item));
        case "notIn":
            if (!Array.isArray(expected))
                return false;
            if (value === null || value === undefined)
                return true;
            return !expected.some((item) => looseEquals(value, item));
        case "greaterThan":
            return compareOrdered(value, expected) === 1;
        case "greaterThanOrEqual": {
            const cmp = compareOrdered(value, expected);
            return cmp === 1 || cmp === 0;
        }
        case "lessThan":
            return compareOrdered(value, expected) === -1;
        case "lessThanOrEqual": {
            const cmp = compareOrdered(value, expected);
            return cmp === -1 || cmp === 0;
        }
        case "contains":
            if (value === null || value === undefined || expected === null || expected === undefined)
                return false;
            return String(value).toLowerCase().includes(String(expected).toLowerCase());
        case "startsWith":
            if (value === null || value === undefined || expected === null || expected === undefined)
                return false;
            return String(value).startsWith(String(expected));
        case "endsWith":
            if (value === null || value === undefined || expected === null || expected === undefined)
                return false;
            return String(value).endsWith(String(expected));
        default:
            return false;
    }
}
function looseEquals(value, expected) {
    if (Array.isArray(value)) {
        return value.some((item) => looseEquals(item, expected));
    }
    const a = toNumber(value);
    const b = toNumber(expected);
    if (a !== null && b !== null)
        return a === b;
    if (typeof value === "boolean" || typeof expected === "boolean") {
        return value === expected;
    }
    return String(value) === String(expected);
}
function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}
/** -1 | 0 | 1, or null when unordered (missing values never match ranges). */
function compareOrdered(value, expected) {
    if (value === null || value === undefined || expected === null || expected === undefined) {
        return null;
    }
    const a = toNumber(value);
    const b = toNumber(expected);
    if (a !== null && b !== null) {
        return a < b ? -1 : a > b ? 1 : 0;
    }
    const sa = String(value);
    const sb = String(expected);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}
// ---------------------------------------------------------------------------
// Projection (document queries)
// ---------------------------------------------------------------------------
function projectDocumentRow(resolved, row) {
    const rootName = resolved.rootModel.name;
    const rootDoc = row.get(rootName);
    const out = { ...rootDoc.source };
    for (const axis of resolved.axes) {
        if (axis.model === rootName)
            continue;
        const doc = row.get(axis.model)?.source;
        out[axis.name] =
            doc === undefined ? undefined : doc[indexedKey(modelOf(resolved, axis.model), axis.field)];
    }
    out._id = rootDoc.id;
    if (resolved.search !== undefined && rootDoc.score !== undefined) {
        out._score = rootDoc.score;
    }
    return out;
}
// ---------------------------------------------------------------------------
// Aggregation (metric queries)
// ---------------------------------------------------------------------------
function aggregateJoinedRows(resolved, rows) {
    if (resolved.axes.length === 0) {
        const out = {};
        for (const metric of resolved.metrics) {
            out[metric.name] = computeMetric(resolved, rows, metric);
        }
        return [out];
    }
    const groups = new Map();
    for (const row of rows) {
        const key = {};
        for (const axis of resolved.axes) {
            key[axis.name] = axisValue(resolved, row, axis.model, axis.field);
        }
        const id = JSON.stringify(resolved.axes.map((axis) => stringifyGroupKey(key[axis.name])));
        const existing = groups.get(id);
        if (existing) {
            existing.rows.push(row);
        }
        else {
            groups.set(id, { key, rows: [row] });
        }
    }
    return [...groups.values()].map(({ key, rows: groupRows }) => {
        const out = { ...key };
        for (const metric of resolved.metrics) {
            out[metric.name] = computeMetric(resolved, groupRows, metric);
        }
        return out;
    });
}
function stringifyGroupKey(value) {
    if (value === null || value === undefined)
        return "\u0000null";
    if (typeof value === "number" || typeof value === "boolean") {
        return `${typeof value}\u0000${String(value)}`;
    }
    return `string\u0000${String(value)}`;
}
function axisValue(resolved, row, modelName, field) {
    const doc = row.get(modelName)?.source;
    if (doc === undefined)
        return undefined;
    return doc[indexedKey(modelOf(resolved, modelName), field)];
}
function computeMetric(resolved, rows, metric) {
    const def = metric.definition;
    const canned = def.filters ?? [];
    const scoped = rows.filter((row) => canned.every((filter) => {
        const ref = parseBareRef(filter.field);
        const targetModel = ref.model ?? metric.model;
        const targetDoc = row.get(targetModel)?.source;
        const targetDef = modelOf(resolved, targetModel);
        const value = targetDoc === undefined
            ? undefined
            : targetDoc[indexedKey(targetDef, ref.field)];
        return matchesOperator(value, filter.operator, filter.value);
    }));
    switch (def.type) {
        case "count": {
            const field = metricValueField(resolved, metric);
            if (field === undefined)
                return scoped.length;
            return scoped.filter((row) => metricFieldValue(resolved, row, metric) !== undefined).length;
        }
        case "countDistinct": {
            const seen = new Set();
            for (const row of scoped) {
                const value = metricFieldValue(resolved, row, metric);
                if (value === null || value === undefined)
                    continue;
                seen.add(stringifyGroupKey(value));
            }
            return seen.size;
        }
        case "sum":
        case "avg":
        case "min":
        case "max": {
            const values = [];
            for (const row of scoped) {
                const n = toNumber(metricFieldValue(resolved, row, metric));
                if (n !== null)
                    values.push(n);
            }
            if (values.length === 0)
                return null;
            if (def.type === "sum")
                return values.reduce((a, b) => a + b, 0);
            if (def.type === "avg") {
                return values.reduce((a, b) => a + b, 0) / values.length;
            }
            if (def.type === "min")
                return Math.min(...values);
            return Math.max(...values);
        }
        default:
            throw new ExecutionError(`Unsupported metric type "${def.type}" for joined search execution.`);
    }
}
/** Indexed field backing a metric, or undefined when it counts rows. */
function metricValueField(resolved, metric) {
    const def = metric.definition;
    if (def.search?.field !== undefined)
        return def.search.field;
    if (def.sql === undefined)
        return undefined;
    const model = modelOf(resolved, metric.model);
    if (model === undefined)
        return undefined;
    // `sql` may name an axis or a DB column of an axis.
    for (const [name, axis] of Object.entries(model.axes)) {
        if (name === def.sql || axis.sql === def.sql) {
            return axis.search?.field ?? name;
        }
    }
    return undefined;
}
function metricFieldValue(resolved, row, metric) {
    const field = metricValueField(resolved, metric);
    if (field === undefined)
        return undefined;
    return row.get(metric.model)?.source[field];
}
/** Split a canned metric filter field into optional model + bare field. */
function parseBareRef(ref) {
    const dot = ref.indexOf(".");
    if (dot < 0)
        return { field: ref };
    return { model: ref.slice(0, dot), field: ref.slice(dot + 1) };
}
// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------
function sortRows(rows, resolved) {
    if (resolved.orderBy.length === 0)
        return;
    const comparators = resolved.orderBy.map((order) => {
        const key = order.field.name;
        const dir = order.node.direction === "desc" ? -1 : 1;
        return (a, b) => {
            const cmp = compareSortValues(a[key], b[key]);
            return cmp * dir;
        };
    });
    rows.sort((a, b) => {
        for (const compare of comparators) {
            const result = compare(a, b);
            if (result !== 0)
                return result;
        }
        return 0;
    });
}
function compareSortValues(a, b) {
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;
    if (aMissing && bMissing)
        return 0;
    if (aMissing)
        return 1;
    if (bMissing)
        return -1;
    const an = toNumber(a);
    const bn = toNumber(b);
    if (an !== null && bn !== null)
        return an < bn ? -1 : an > bn ? 1 : 0;
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}
//# sourceMappingURL=joined-search.js.map