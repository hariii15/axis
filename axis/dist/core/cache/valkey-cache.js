import { Redis } from "ioredis";
const DEFAULT_CLEAR_MATCH = "axis:*";
const DEFAULT_SCAN_COUNT = 100;
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
export class ValkeyCache {
    client;
    ownsClient;
    clearMatch;
    scanCount;
    constructor(options = {}) {
        if (options.client !== undefined) {
            this.client = options.client;
            this.ownsClient = false;
        }
        else {
            // Adapted (not stored as `Redis`): ioredis' overloaded `set`
            // accepts trailing callbacks, so its type is not assignable to
            // the minimal `ValkeyClient` surface. The adapter forwards only
            // the argument shapes this class actually uses.
            this.client = adaptRedis(new Redis(options.url ?? "valkey://localhost:6379", {
                lazyConnect: true,
                enableAutoPipelining: true,
            }));
            this.ownsClient = true;
        }
        this.clearMatch = options.clearMatch ?? DEFAULT_CLEAR_MATCH;
        this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
    }
    async get(key) {
        const raw = await this.client.get(key);
        if (raw === null) {
            return undefined;
        }
        try {
            return JSON.parse(raw);
        }
        catch {
            // Corrupt entry: fail open as a miss and reap it best-effort.
            await this.client.del(key).catch(() => undefined);
            return undefined;
        }
    }
    async set(key, value, ttl) {
        assertTtl(ttl);
        if (ttl === 0) {
            // Valkey rejects `PX 0`; zero means "already expired",
            // so there is nothing worth writing.
            return;
        }
        const raw = JSON.stringify(value);
        if (raw === undefined) {
            throw new TypeError("ValkeyCache cannot serialize value: JSON.stringify returned undefined");
        }
        if (ttl === undefined) {
            await this.client.set(key, raw);
        }
        else {
            await this.client.set(key, raw, "PX", Math.floor(ttl));
        }
    }
    async delete(key) {
        await this.client.del(key);
    }
    async clear() {
        let cursor = "0";
        do {
            const [next, keys] = await this.client.scan(cursor, "MATCH", this.clearMatch, "COUNT", this.scanCount);
            cursor = next;
            if (keys.length > 0) {
                // UNLINK is non-blocking; fall back to DEL-shaped callers via client.
                await this.client.unlink(...keys);
            }
        } while (cursor !== "0");
    }
    describe() {
        // Size would require a full keyspace scan — report unknown
        // rather than something expensive or misleading.
        return {};
    }
    /** Disconnect, but only a client this instance created. */
    async close() {
        if (this.ownsClient) {
            await this.client.quit().catch(() => undefined);
        }
    }
}
function adaptRedis(redis) {
    return {
        get: (key) => redis.get(key),
        set: (key, value, ...args) => redis.set(key, value, ...args),
        del: (...keys) => redis.del(...keys),
        unlink: (...keys) => redis.unlink(...keys),
        scan: (cursor, ...args) => redis.scan(cursor, ...args),
        quit: () => redis.quit(),
    };
}
function assertTtl(ttl) {
    if (ttl === undefined) {
        return;
    }
    if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
        throw new RangeError(`Cache TTL must be a finite number of milliseconds, got: ${String(ttl)}`);
    }
    if (ttl < 0) {
        throw new RangeError(`Cache TTL cannot be negative, got: ${ttl}`);
    }
}
//# sourceMappingURL=valkey-cache.js.map