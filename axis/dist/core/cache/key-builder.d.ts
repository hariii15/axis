import type { AxisQuery } from "../query/types.js";
export interface CacheKeyOptions {
    prefix?: string;
    algorithm?: string;
    /**
     * Security subset for security-aware cache keys (Phase 8).
     *
     * Must be the canonical `cacheKey` from `resolveSecurityContext`
     * (only values for configured mappings). Different security values
     * produce different digests; absent/empty security preserves the
     * legacy key so non-security queries are unaffected.
     */
    security?: Record<string, unknown>;
}
export declare function buildCacheKey(query: AxisQuery, options?: CacheKeyOptions): string;
//# sourceMappingURL=key-builder.d.ts.map