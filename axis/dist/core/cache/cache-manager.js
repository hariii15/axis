import { buildCacheKey } from "./key-builder.js";
import { MemoryCache } from "./memory-cache.js";
export const DEFAULT_CACHE_TTL_MS = 60_000;
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
export class CacheManager {
    backend;
    ownsBackend;
    defaultTtl;
    enabled;
    keyPrefix;
    /** Distinct cache keys written per model, for `invalidateModel`. */
    keysByModel = new Map();
    hits = 0;
    misses = 0;
    sets = 0;
    deletes = 0;
    constructor(options = {}) {
        if (options.ttl !== undefined &&
            (typeof options.ttl !== "number" ||
                !Number.isFinite(options.ttl) ||
                options.ttl < 0)) {
            throw new RangeError(`CacheManager ttl must be a finite number >= 0 (ms), got: ${String(options.ttl)}`);
        }
        this.backend = options.backend ?? new MemoryCache();
        this.ownsBackend = options.backend === undefined;
        this.defaultTtl = options.ttl ?? DEFAULT_CACHE_TTL_MS;
        this.enabled = options.enabled ?? true;
        this.keyPrefix = options.keyPrefix ?? "axis";
    }
    /** Is caching active? */
    get isEnabled() {
        return this.enabled;
    }
    /** Default TTL (ms) applied when a call does not override it. */
    get ttl() {
        return this.defaultTtl;
    }
    /** Deterministic key for a query (same input → same key). */
    keyFor(query, security) {
        if (security === undefined) {
            return buildCacheKey(query, { prefix: this.keyPrefix });
        }
        return buildCacheKey(query, { prefix: this.keyPrefix, security });
    }
    /**
     * Look up a cached query result. Misses (absent, expired, corrupt,
     * disabled, or backend failure) resolve to `undefined`.
     */
    async get(query, security) {
        if (!this.enabled) {
            return undefined;
        }
        let key;
        try {
            key = this.keyFor(query, security);
        }
        catch {
            // Unbuildable key (should be impossible post-validation):
            // fail open as a miss.
            this.misses += 1;
            return undefined;
        }
        try {
            const value = await this.backend.get(key);
            if (value === undefined) {
                this.misses += 1;
                return undefined;
            }
            this.hits += 1;
            // The caller owns their copy: mutating a hit must never
            // poison the entry for subsequent readers.
            return cloneValue(value);
        }
        catch {
            this.misses += 1;
            return undefined;
        }
    }
    /**
     * Store a query result. `ttl` overrides the manager default for
     * this entry only (per-query TTL, Phase 11).
     */
    async set(query, value, ttl, security) {
        if (!this.enabled) {
            return;
        }
        let key;
        try {
            key = this.keyFor(query, security);
        }
        catch {
            return;
        }
        try {
            // The cache owns its copy: the caller may mutate the object
            // they passed in (or the one we return) without corrupting
            // the entry. Remote backends already isolate via serialization;
            // this keeps in-process backends to the same contract.
            await this.backend.set(key, cloneValue(value), ttl ?? this.defaultTtl);
        }
        catch {
            return;
        }
        this.sets += 1;
        this.trackKey(query.model, key);
    }
    /** Delete the entry for one exact query. */
    async delete(query, security) {
        if (!this.enabled) {
            return;
        }
        let key;
        try {
            key = this.keyFor(query, security);
        }
        catch {
            return;
        }
        try {
            await this.backend.delete(key);
        }
        catch {
            return;
        }
        this.deletes += 1;
        this.untrackKey(query.model, key);
    }
    /**
     * Invalidate every cached query for one model (Phase 13).
     *
     * The key format embeds the model (`<prefix>:<Model>:<digest>`),
     * so the manager knows exactly which keys belong to it — no need
     * to blindly clear the entire cache when one dataset changes.
     *
     * @returns number of entries removed.
     */
    async invalidateModel(model) {
        if (!this.enabled) {
            return 0;
        }
        const keys = this.keysByModel.get(model);
        if (keys === undefined || keys.size === 0) {
            return 0;
        }
        let removed = 0;
        for (const key of keys) {
            try {
                await this.backend.delete(key);
                removed += 1;
            }
            catch {
                // Fail open: keep going through the remaining keys.
            }
        }
        this.deletes += removed;
        this.keysByModel.delete(model);
        return removed;
    }
    /** Drop everything (all models) and forget all tracked keys. */
    async clear() {
        this.keysByModel.clear();
        if (!this.enabled) {
            return;
        }
        try {
            await this.backend.clear();
        }
        catch {
            // Fail open.
        }
    }
    /** Counters plus backend info when the backend reports it. */
    async stats() {
        const snapshot = {
            hits: this.hits,
            misses: this.misses,
            sets: this.sets,
            deletes: this.deletes,
        };
        if (!this.enabled) {
            return snapshot;
        }
        try {
            const info = await this.backend.describe?.();
            if (info?.size !== undefined) {
                snapshot.entries = info.size;
            }
            if (info?.evictions !== undefined) {
                snapshot.evictions = info.evictions;
            }
        }
        catch {
            // Stats must never throw.
        }
        return snapshot;
    }
    /** Zero all counters (entries are untouched). */
    resetStats() {
        this.hits = 0;
        this.misses = 0;
        this.sets = 0;
        this.deletes = 0;
    }
    /**
     * Release backend resources. Only closes backends the manager
     * created itself — an injected backend stays the caller's own.
     */
    async close() {
        if (this.ownsBackend) {
            await this.backend.close?.();
        }
    }
    trackKey(model, key) {
        let keys = this.keysByModel.get(model);
        if (keys === undefined) {
            keys = new Set();
            this.keysByModel.set(model, keys);
        }
        keys.add(key);
    }
    untrackKey(model, key) {
        const keys = this.keysByModel.get(model);
        if (keys === undefined) {
            return;
        }
        keys.delete(key);
        if (keys.size === 0) {
            this.keysByModel.delete(model);
        }
    }
}
/**
 * Deep copy with a reference fallback. `structuredClone` fails on
 * functions/symbols — those can never be valid cached query results,
 * but a fallback beats crashing the query path.
 */
function cloneValue(value) {
    try {
        return structuredClone(value);
    }
    catch {
        return value;
    }
}
//# sourceMappingURL=cache-manager.js.map