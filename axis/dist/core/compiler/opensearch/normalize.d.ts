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
export declare function normalizeAggregationRows(axes: string[], metrics: string[], aggregations: Record<string, unknown>): Record<string, unknown>[];
/**
 * Extract a scalar from a metric agg result.
 * `value_count` / `sum` / `avg` / `min` / `max` / `cardinality`
 * all respond with `{ value: number | null }`.
 * Canned-filter metrics are wrapped in a `filter` agg, responding with
 * `{ doc_count, value: { value: number | null } }` — unwrap one more level.
 */
export declare function metricValue(result: unknown): unknown;
//# sourceMappingURL=normalize.d.ts.map