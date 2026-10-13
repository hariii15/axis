import { buildCacheKey } from "./key-builder.js";
import { MemoryCache } from "./memory-cache.js";

import type { AxisQuery } from "../query/types.js";
import type { Cache } from "./types.js";

export const DEFAULT_CACHE_TTL_MS = 60_000;

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
export class CacheManager {
  private readonly backend: Cache;
  private readonly ownsBackend: boolean;
  private readonly defaultTtl: number;
  private readonly enabled: boolean;
  private readonly keyPrefix: string;

  /** Distinct cache keys written per model, for `invalidateModel`. */
  private readonly keysByModel = new Map<string, Set<string>>();

  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;

  constructor(options: CacheManagerOptions = {}) {
    if (
      options.ttl !== undefined &&
      (typeof options.ttl !== "number" ||
        !Number.isFinite(options.ttl) ||
        options.ttl < 0)
    ) {
      throw new RangeError(
        `CacheManager ttl must be a finite number >= 0 (ms), got: ${String(options.ttl)}`,
      );
    }
    this.backend = options.backend ?? new MemoryCache();
    this.ownsBackend = options.backend === undefined;
    this.defaultTtl = options.ttl ?? DEFAULT_CACHE_TTL_MS;
    this.enabled = options.enabled ?? true;
    this.keyPrefix = options.keyPrefix ?? "axis";
  }

  /** Is caching active? */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Default TTL (ms) applied when a call does not override it. */
  get ttl(): number {
    return this.defaultTtl;
  }

  /** Deterministic key for a query (same input → same key). */
  keyFor(query: AxisQuery, security?: Record<string, unknown>): string {
    if (security === undefined) {
      return buildCacheKey(query, { prefix: this.keyPrefix });
    }
    return buildCacheKey(query, { prefix: this.keyPrefix, security });
  }

  /**
   * Look up a cached query result. Misses (absent, expired, corrupt,
   * disabled, or backend failure) resolve to `undefined`.
   */
  async get<T>(
    query: AxisQuery,
    security?: Record<string, unknown>,
  ): Promise<T | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    let key: string;
    try {
      key = this.keyFor(query, security);
    } catch {
      // Unbuildable key (should be impossible post-validation):
      // fail open as a miss.
      this.misses += 1;
      return undefined;
    }
    try {
      const value = await this.backend.get<T>(key);
      if (value === undefined) {
        this.misses += 1;
        return undefined;
      }
      this.hits += 1;
      // The caller owns their copy: mutating a hit must never
      // poison the entry for subsequent readers.
      return cloneValue(value);
    } catch {
      this.misses += 1;
      return undefined;
    }
  }

  /**
   * Store a query result. `ttl` overrides the manager default for
   * this entry only (per-query TTL, Phase 11).
   */
  async set<T>(
    query: AxisQuery,
    value: T,
    ttl?: number,
    security?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }
    let key: string;
    try {
      key = this.keyFor(query, security);
    } catch {
      return;
    }
    try {
      // The cache owns its copy: the caller may mutate the object
      // they passed in (or the one we return) without corrupting
      // the entry. Remote backends already isolate via serialization;
      // this keeps in-process backends to the same contract.
      await this.backend.set(key, cloneValue(value), ttl ?? this.defaultTtl);
    } catch {
      return;
    }
    this.sets += 1;
    this.trackKey(query.model, key);
  }

  /** Delete the entry for one exact query. */
  async delete(
    query: AxisQuery,
    security?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }
    let key: string;
    try {
      key = this.keyFor(query, security);
    } catch {
      return;
    }
    try {
      await this.backend.delete(key);
    } catch {
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
  async invalidateModel(model: string): Promise<number> {
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
      } catch {
        // Fail open: keep going through the remaining keys.
      }
    }
    this.deletes += removed;
    this.keysByModel.delete(model);
    return removed;
  }

  /** Drop everything (all models) and forget all tracked keys. */
  async clear(): Promise<void> {
    this.keysByModel.clear();
    if (!this.enabled) {
      return;
    }
    try {
      await this.backend.clear();
    } catch {
      // Fail open.
    }
  }

  /** Counters plus backend info when the backend reports it. */
  async stats(): Promise<CacheStatsSnapshot> {
    const snapshot: CacheStatsSnapshot = {
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
    } catch {
      // Stats must never throw.
    }
    return snapshot;
  }

  /** Zero all counters (entries are untouched). */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
  }

  /**
   * Release backend resources. Only closes backends the manager
   * created itself — an injected backend stays the caller's own.
   */
  async close(): Promise<void> {
    if (this.ownsBackend) {
      await this.backend.close?.();
    }
  }

  private trackKey(model: string, key: string): void {
    let keys = this.keysByModel.get(model);
    if (keys === undefined) {
      keys = new Set();
      this.keysByModel.set(model, keys);
    }
    keys.add(key);
  }

  private untrackKey(model: string, key: string): void {
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
function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
