import type { ResolvedQuery, ResolvedAxis, ResolvedMetric } from "../../resolver/type.js";
import type { CompiledOpenSearchQuery } from "./types.js";
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
export declare function compileToOpenSearch(query: ResolvedQuery, options?: CompileToOpenSearchOptions): CompiledOpenSearchQuery;
export declare function searchFieldForAxis(axis: ResolvedAxis): string;
export declare function searchFieldForMetric(metric: ResolvedMetric): string;
//# sourceMappingURL=compiler.d.ts.map