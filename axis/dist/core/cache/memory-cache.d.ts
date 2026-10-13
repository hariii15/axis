import type { Cache, CacheInfo } from "./types.js";
export interface MemoryCacheOptions {
    /**
     * Maximum number of entries held. When exceeded, expired entries are
     * dropped first, then the oldest-inserted entries. Must be >= 1.
     *
     * @default 1000
     */
    maxSize?: number;
}
export declare class MemoryCache implements Cache {
    private readonly store;
    private readonly maxSize;
    private evictionCount;
    constructor(options?: MemoryCacheOptions);
    /** Number of entries currently held (including not-yet-reaped expired ones). */
    get size(): number;
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    describe(): CacheInfo;
    /**
     * Enforce the size cap. Expired entries are dropped first (they are
     * garbage anyway); only if still over capacity are the oldest live
     * entries evicted. Both passes stop as soon as the cap is met, and
     * `set` is the only writer, so this work stays proportional to the
     * overflow rather than the whole map.
     */
    private evictOverflow;
}
//# sourceMappingURL=memory-cache.d.ts.map