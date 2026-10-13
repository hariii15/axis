import type { Cache, CacheInfo } from "./types.js";
/**
 * Minimal command surface ValkeyCache needs. `ioredis`' `Redis`
 * satisfies this structurally, and tests inject an in-memory fake —
 * no live server required to verify behavior.
 */
export interface ValkeyClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    unlink(...keys: string[]): Promise<unknown>;
    scan(cursor: string | number, ...args: (string | number)[]): Promise<[string, string[]]>;
    quit(): Promise<unknown>;
}
export interface ValkeyCacheOptions {
    /**
     * Connection URL, e.g. `valkey://localhost:6379`.
     * Ignored when `client` is injected.
     */
    url?: string;
    /**
     * Existing client (shared connection, tests, custom config).
     * The adapter never closes an injected client.
     */
    client?: ValkeyClient;
    /**
     * `SCAN MATCH` pattern used by `clear()`. Defaults to the
     * manager's key namespace — never `*`, so a shared instance
     * is never wiped wholesale.
     *
     * @default "axis:*"
     */
    clearMatch?: string;
    /** `SCAN COUNT` hint per iteration. @default 100 */
    scanCount?: number;
}
/**
 * Production `Cache` backend over Valkey / Redis (Phase 15).
 *
 * Interchangeable with `MemoryCache` behind the `Cache` interface —
 * the manager and engine never know which one is wired:
 *
 * ```ts
 * new Axis({
 *   database: { url: process.env.DATABASE_URL },
 *   cache: {
 *     enabled: true,
 *     ttl: 60_000,
 *     backend: new ValkeyCache({ url: process.env.VALKEY_URL }),
 *   },
 * });
 * ```
 *
 * Notes:
 * - Values are JSON-serialized; a corrupt entry is treated as a miss.
 * - TTL is in **milliseconds** and stored via `PX` (exact, no
 *   seconds-rounding). `ttl: 0` (immediate expiry) skips the write
 *   because Valkey rejects `PX 0`.
 * - `clear()` only removes keys matching `clearMatch` (SCAN-based),
 *   never `FLUSHDB`.
 */
export declare class ValkeyCache implements Cache {
    private readonly client;
    private readonly ownsClient;
    private readonly clearMatch;
    private readonly scanCount;
    constructor(options?: ValkeyCacheOptions);
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    describe(): CacheInfo;
    /** Disconnect, but only a client this instance created. */
    close(): Promise<void>;
}
//# sourceMappingURL=valkey-cache.d.ts.map