import type { AxisQuery } from "../query/types.js";
import type { Cache } from "./types.js";
export declare const DEFAULT_CACHE_TTL_MS = 60000;
export interface CacheManagerOptions {
    /**
     * Storage backend. Axis never talks to a concrete store — any
     * `Cache` implementation works (`MemoryCache`, `ValkeyCache`, …).
     *
     * @default new MemoryCache()
     */
    backend?: Cache;
    /**
     * Default time-to-live in **milliseconds** applied to every `set`
     * unless a per-call TTL overrides it.
     *
     * @default 60_000
     */
    ttl?: number;
    /**
     * Master switch. When `false`, every method is a silent no-op
     * (`get` always misses) and the backend is never touched.
     *
     * @default true
     */
    enabled?: boolean;
    /**
     * Key namespace forwarded to the key builder
     * (`<prefix>:<Model>:<digest>`).
     *
     * @default "axis"
     */
    keyPrefix?: string;
}
/**
 * Counters owned by the manager itself. `entries` / `evictions`
 * are merged in from the backend when it reports them.
 */
export interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
}
export interface CacheStatsSnapshot extends CacheStats {
    /** Entries currently held, when the backend reports it. */
    entries?: number;
    /** Capacity-driven evictions, when the backend reports them. */
    evictions?: number;
}
/**
 * Central caching abstraction (Phase 9).
 *
 * Owns the full lifecycle for a query result:
 *
 *   key generation → cache lookup → hit / miss → store result
 *
 * Plus statistics (Phase 12) and per-model invalidation (Phase 13).
 * All backend failures are fail-open: a throwing backend degrades to
 * "always miss, never store" so queries keep working without cache.
 */
export declare class CacheManager {
    private readonly backend;
    private readonly ownsBackend;
    private readonly defaultTtl;
    private readonly enabled;
    private readonly keyPrefix;
    /** Distinct cache keys written per model, for `invalidateModel`. */
    private readonly keysByModel;
    private hits;
    private misses;
    private sets;
    private deletes;
    constructor(options?: CacheManagerOptions);
    /** Is caching active? */
    get isEnabled(): boolean;
    /** Default TTL (ms) applied when a call does not override it. */
    get ttl(): number;
    /** Deterministic key for a query (same input → same key). */
    keyFor(query: AxisQuery, security?: Record<string, unknown>): string;
    /**
     * Look up a cached query result. Misses (absent, expired, corrupt,
     * disabled, or backend failure) resolve to `undefined`.
     */
    get<T>(query: AxisQuery, security?: Record<string, unknown>): Promise<T | undefined>;
    /**
     * Store a query result. `ttl` overrides the manager default for
     * this entry only (per-query TTL, Phase 11).
     */
    set<T>(query: AxisQuery, value: T, ttl?: number, security?: Record<string, unknown>): Promise<void>;
    /** Delete the entry for one exact query. */
    delete(query: AxisQuery, security?: Record<string, unknown>): Promise<void>;
    /**
     * Invalidate every cached query for one model (Phase 13).
     *
     * The key format embeds the model (`<prefix>:<Model>:<digest>`),
     * so the manager knows exactly which keys belong to it — no need
     * to blindly clear the entire cache when one dataset changes.
     *
     * @returns number of entries removed.
     */
    invalidateModel(model: string): Promise<number>;
    /** Drop everything (all models) and forget all tracked keys. */
    clear(): Promise<void>;
    /** Counters plus backend info when the backend reports it. */
    stats(): Promise<CacheStatsSnapshot>;
    /** Zero all counters (entries are untouched). */
    resetStats(): void;
    /**
     * Release backend resources. Only closes backends the manager
     * created itself — an injected backend stays the caller's own.
     */
    close(): Promise<void>;
    private trackKey;
    private untrackKey;
}
//# sourceMappingURL=cache-manager.d.ts.map