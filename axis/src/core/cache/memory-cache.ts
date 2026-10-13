import type { Cache, CacheInfo } from "./types.js";

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export interface MemoryCacheOptions {
  /**
   * Maximum number of entries held. When exceeded, expired entries are
   * dropped first, then the oldest-inserted entries. Must be >= 1.
   *
   * @default 1000
   */
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 1000;

export class MemoryCache implements Cache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private evictionCount = 0;

  constructor(options: MemoryCacheOptions = {}) {
    const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError(
        `MemoryCache maxSize must be a positive integer, got: ${maxSize}`,
      );
    }
    this.maxSize = maxSize;
  }

  /** Number of entries currently held (including not-yet-reaped expired ones). */
  get size(): number {
    return this.store.size;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    if (
      entry.expiresAt !== undefined &&
      Date.now() >= entry.expiresAt
    ) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(
    key: string,
    value: T,
    ttl?: number,
  ): Promise<void> {
    const expiresAt = toExpiresAt(ttl);

    // Delete-then-set so an overwrite refreshes insertion order and is
    // not evicted as "oldest" below.
    this.store.delete(key);
    this.store.set(
      key,
      expiresAt === undefined ? { value } : { value, expiresAt },
    );
    this.evictOverflow();
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  describe(): CacheInfo {
    return { size: this.store.size, evictions: this.evictionCount };
  }

  /**
   * Enforce the size cap. Expired entries are dropped first (they are
   * garbage anyway); only if still over capacity are the oldest live
   * entries evicted. Both passes stop as soon as the cap is met, and
   * `set` is the only writer, so this work stays proportional to the
   * overflow rather than the whole map.
   */
  private evictOverflow(): void {
    if (this.store.size <= this.maxSize) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (this.store.size <= this.maxSize) {
        return;
      }
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }

    // Map preserves insertion order, so iteration starts at the oldest.
    for (const key of this.store.keys()) {
      if (this.store.size <= this.maxSize) {
        return;
      }
      this.store.delete(key);
      this.evictionCount += 1;
    }
  }
}

/** Validate TTL (milliseconds) and convert to an absolute expiry timestamp. */
function toExpiresAt(ttl: number | undefined): number | undefined {
  if (ttl === undefined) {
    return undefined;
  }
  if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
    throw new RangeError(
      `Cache TTL must be a finite number of milliseconds, got: ${String(ttl)}`,
    );
  }
  if (ttl < 0) {
    throw new RangeError(`Cache TTL cannot be negative, got: ${ttl}`);
  }
  return Date.now() + ttl;
}
