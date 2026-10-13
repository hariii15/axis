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
import type { FilterOperator, FilterValue } from "../query/types.js";
import type { ResolvedQuery } from "../resolver/type.js";
import type { SearchAdapter } from "./types.js";
export interface JoinedSearchOptions {
    /** Prebuilt security DSL filters — applied to the root fetch only. */
    securityFilters?: Record<string, unknown>[];
    /** Query embedding for semantic/hybrid search (root fetch only). */
    queryVector?: number[];
}
/**
 * Per-model document cap for in-memory joining. A2-scale datasets
 * (thousands of docs) fit comfortably; larger totals fail closed with a
 * clear error instead of silently truncating the join.
 */
export declare const JOINED_FETCH_CAP = 10000;
export declare function searchJoinedDocuments(resolved: ResolvedQuery, search: SearchAdapter, options?: JoinedSearchOptions): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
}>;
export declare function matchesOperator(value: unknown, operator: FilterOperator, expected: FilterValue | undefined): boolean;
//# sourceMappingURL=joined-search.d.ts.map