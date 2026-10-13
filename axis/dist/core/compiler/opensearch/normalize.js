/**
 * Normalize OpenSearch aggregation results into SQL-shaped rows.
 *
 * Mirrors the structure emitted by `buildDSL` in `./compiler.ts`:
 * - metric-only query → top-level metric aggs → a single row
 *   (`{ newCount: 6 }`), like `SELECT COUNT(*) ...` without GROUP BY.
 * - axes + metrics → the nested `<name>_terms` bucket chain → one row
 *   per leaf bucket (`{ department: "Eng", status: 1, newCount: 2 }`),
 *   like GROUP BY over multiple columns.
 */
export function normalizeAggregationRows(axes, metrics, aggregations) {
    if (axes.length === 0) {
        const row = {};
        for (const metric of metrics) {
            row[metric] = metricValue(aggregations[metric]);
        }
        return [row];
    }
    const top = aggregations[`${axes[0]}_terms`];
    return walkBuckets(axes, 0, metrics, top, {});
}
/**
 * Walk one level of a nested terms chain, accumulating axis keys.
 * A level with no buckets contributes no rows (no docs = no group).
 */
function walkBuckets(axes, depth, metrics, terms, prefix) {
    const axis = axes[depth];
    const buckets = Array.isArray(terms?.buckets) ? terms.buckets : [];
    return buckets.flatMap((bucket) => {
        const row = { ...prefix, [axis]: bucket["key"] };
        if (depth === axes.length - 1) {
            for (const metric of metrics) {
                row[metric] = metricValue(bucket[metric]);
            }
            return [row];
        }
        const next = bucket[`${axes[depth + 1]}_terms`];
        return walkBuckets(axes, depth + 1, metrics, next, row);
    });
}
/**
 * Extract a scalar from a metric agg result.
 * `value_count` / `sum` / `avg` / `min` / `max` / `cardinality`
 * all respond with `{ value: number | null }`.
 * Canned-filter metrics are wrapped in a `filter` agg, responding with
 * `{ doc_count, value: { value: number | null } }` — unwrap one more level.
 */
export function metricValue(result) {
    if (typeof result === "object" && result !== null && "value" in result) {
        const inner = result.value;
        if (typeof inner === "object" &&
            inner !== null &&
            "value" in inner) {
            return inner.value;
        }
        return inner;
    }
    return undefined;
}
//# sourceMappingURL=normalize.js.map