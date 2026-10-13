import { Redis } from "ioredis";

import type { Cache, CacheInfo } from "./types.js";

/**
 * Minimal command surface ValkeyCache needs. `ioredis`' `Redis`
 * satisfies this structurally, and tests inject an in-memory fake —
 * no live server required to verify behavior.
 */
export interface ValkeyClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  unlink(...keys: string[]): Promise<unknown>;
  scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[string, string[]]>;
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
export class ValkeyCache implements Cache {
  private readonly client: ValkeyClient;
  private readonly ownsClient: boolean;
  private readonly clearMatch: string;
  private readonly scanCount: number;

  constructor(options: ValkeyCacheOptions = {}) {
    if (options.client !== undefined) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      // Adapted (not stored as `Redis`): ioredis' overloaded `set`
      // accepts trailing callbacks, so its type is not assignable to
      // the minimal `ValkeyClient` surface. The adapter forwards only
      // the argument shapes this class actually uses.
      this.client = adaptRedis(
        new Redis(options.url ?? "valkey://localhost:6379", {
          lazyConnect: true,
          enableAutoPipelining: true,
        }),
      );
      this.ownsClient = true;
    }
    this.clearMatch = options.clearMatch ?? DEFAULT_CLEAR_MATCH;
    this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt entry: fail open as a miss and reap it best-effort.
      await this.client.del(key).catch(() => undefined);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    assertTtl(ttl);
    if (ttl === 0) {
      // Valkey rejects `PX 0`; zero means "already expired",
      // so there is nothing worth writing.
      return;
    }
    const raw = JSON.stringify(value);
    if (raw === undefined) {
      throw new TypeError(
        "ValkeyCache cannot serialize value: JSON.stringify returned undefined",
      );
    }
    if (ttl === undefined) {
      await this.client.set(key, raw);
    } else {
      await this.client.set(key, raw, "PX", Math.floor(ttl));
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        this.clearMatch,
        "COUNT",
        this.scanCount,
      );
      cursor = next;
      if (keys.length > 0) {
        // UNLINK is non-blocking; fall back to DEL-shaped callers via client.
        await this.client.unlink(...keys);
      }
    } while (cursor !== "0");
  }

  describe(): CacheInfo {
    // Size would require a full keyspace scan — report unknown
    // rather than something expensive or misleading.
    return {};
  }

  /** Disconnect, but only a client this instance created. */
  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.client.quit().catch(() => undefined);
    }
  }
}

function adaptRedis(redis: Redis): ValkeyClient {
  return {
    get: (key) => redis.get(key),
    set: (key, value, ...args) =>
      (
        redis.set as unknown as (
          ...a: (string | number)[]
        ) => Promise<unknown>
      )(key, value, ...args),
    del: (...keys) => redis.del(...keys),
    unlink: (...keys) => redis.unlink(...keys),
    scan: (cursor, ...args) =>
      (
        redis.scan as unknown as (
          c: string | number,
          ...a: (string | number)[]
        ) => Promise<[string, string[]]>
      )(cursor, ...args),
    quit: () => redis.quit(),
  };
}

function assertTtl(ttl: number | undefined): void {
  if (ttl === undefined) {
    return;
  }
  if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
    throw new RangeError(
      `Cache TTL must be a finite number of milliseconds, got: ${String(ttl)}`,
    );
  }
  if (ttl < 0) {
    throw new RangeError(`Cache TTL cannot be negative, got: ${ttl}`);
  }
}
