import { describe, expect, it } from "vitest";

import { CacheManager } from "../../src/core/cache/cache-manager.js";
import { MemoryCache } from "../../src/core/cache/memory-cache.js";
import type { Cache } from "../../src/core/cache/types.js";
import type { AxisQuery } from "../../src/core/query/types.js";

const Q_A1: AxisQuery = { model: "A", metrics: ["c"] };
const Q_A2: AxisQuery = { model: "A", axes: ["d"], metrics: ["c"] };
const Q_B1: AxisQuery = { model: "B", metrics: ["c"] };

/** Backend that always fails — proves fail-open behavior. */
class ThrowingCache implements Cache {
  async get<T>(): Promise<T | undefined> {
    throw new Error("backend down");
  }
  async set<T>(): Promise<void> {
    throw new Error("backend down");
  }
  async delete(): Promise<void> {
    throw new Error("backend down");
  }
  async clear(): Promise<void> {
    throw new Error("backend down");
  }
}

/** Backend that records the TTL of every write. */
class RecordingCache extends MemoryCache {
  public ttls: (number | undefined)[] = [];
  override async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.ttls.push(ttl);
    return super.set(key, value, ttl);
  }
}

describe("CacheManager — construction", () => {
  it("defaults to enabled with a 60s TTL and a MemoryCache", async () => {
    const manager = new CacheManager();

    expect(manager.isEnabled).toBe(true);
    expect(manager.ttl).toBe(60_000);
    expect(await manager.get(Q_A1)).toBeUndefined();
  });

  it("rejects an invalid default TTL", () => {
    expect(() => new CacheManager({ ttl: -1 })).toThrow(RangeError);
    expect(() => new CacheManager({ ttl: Number.NaN })).toThrow(RangeError);
  });

  it("builds stable keys (same query → same key)", () => {
    const manager = new CacheManager();

    expect(manager.keyFor(Q_A1)).toBe(manager.keyFor({ ...Q_A1 }));
    expect(manager.keyFor(Q_A1)).toMatch(/^axis:A:[0-9a-f]{64}$/);
  });

  it("honors a custom key prefix", () => {
    const manager = new CacheManager({ keyPrefix: "axis:v2" });

    expect(manager.keyFor(Q_A1)).toMatch(/^axis:v2:A:[0-9a-f]{64}$/);
  });
});

describe("CacheManager — get / set (Phase 9)", () => {
  it("misses, then hits after set", async () => {
    const manager = new CacheManager();

    expect(await manager.get(Q_A1)).toBeUndefined();
    await manager.set(Q_A1, { rows: [{ c: 1 }], rowCount: 1 });
    expect(await manager.get(Q_A1)).toEqual({
      rows: [{ c: 1 }],
      rowCount: 1,
    });
  });

  it("tracks hits, misses and sets", async () => {
    const manager = new CacheManager();

    await manager.get(Q_A1); // miss
    await manager.get(Q_A1); // miss
    await manager.set(Q_A1, 1);
    await manager.get(Q_A1); // hit
    await manager.delete(Q_A1);

    expect(await manager.stats()).toMatchObject({
      hits: 1,
      misses: 2,
      sets: 1,
      deletes: 1,
    });
  });

  it("uses the default TTL unless overridden per call (Phase 11)", async () => {
    const backend = new RecordingCache();
    const manager = new CacheManager({ backend, ttl: 5_000 });

    await manager.set(Q_A1, 1);
    await manager.set(Q_A2, 2, 500);

    expect(backend.ttls).toEqual([5_000, 500]);
  });

  it("does not share object references with callers", async () => {
    const manager = new CacheManager();
    const stored = { rows: [{ c: 1 }] };

    await manager.set(Q_A1, stored);
    stored.rows.push({ c: 999 }); // mutate after set…

    const hit = (await manager.get<{ rows: { c: number }[] }>(Q_A1))!;
    expect(hit.rows).toEqual([{ c: 1 }]);

    hit.rows.push({ c: 999 }); // …and mutate a hit…
    expect(await manager.get(Q_A1)).toEqual({ rows: [{ c: 1 }] });
  });
});

describe("CacheManager — disabled mode", () => {
  it("never touches the backend and always misses", async () => {
    const manager = new CacheManager({
      backend: new ThrowingCache(),
      enabled: false,
    });

    expect(manager.isEnabled).toBe(false);
    expect(await manager.get(Q_A1)).toBeUndefined();
    await manager.set(Q_A1, 1); // must not throw
    await manager.delete(Q_A1); // must not throw
    await manager.clear(); // must not throw
    expect(await manager.invalidateModel("A")).toBe(0);
    expect(await manager.stats()).toEqual({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    });
  });
});

describe("CacheManager — fail-open", () => {
  it("a dead backend degrades to miss / no-store without throwing", async () => {
    const manager = new CacheManager({ backend: new ThrowingCache() });

    expect(await manager.get(Q_A1)).toBeUndefined();
    await manager.set(Q_A1, 1);
    await manager.delete(Q_A1);
    await manager.clear();
    expect(await manager.invalidateModel("A")).toBe(0);

    // The miss was still counted — stats stay truthful.
    expect(await manager.stats()).toMatchObject({ misses: 1 });
  });
});

describe("CacheManager — invalidation (Phase 13)", () => {
  it("invalidateModel removes one model's entries and returns the count", async () => {
    const manager = new CacheManager();

    await manager.set(Q_A1, 1);
    await manager.set(Q_A2, 2);
    await manager.set(Q_B1, 3);

    expect(await manager.invalidateModel("A")).toBe(2);
    expect(await manager.get(Q_A1)).toBeUndefined();
    expect(await manager.get(Q_A2)).toBeUndefined();
    expect(await manager.get(Q_B1)).toBe(3); // untouched
  });

  it("invalidateModel is idempotent and reports 0 for unknown models", async () => {
    const manager = new CacheManager();

    await manager.set(Q_A1, 1);
    expect(await manager.invalidateModel("A")).toBe(1);
    expect(await manager.invalidateModel("A")).toBe(0);
    expect(await manager.invalidateModel("Ghost")).toBe(0);
  });

  it("delete() forgets the key so later invalidation skips it", async () => {
    const manager = new CacheManager();

    await manager.set(Q_A1, 1);
    await manager.delete(Q_A1);

    expect(await manager.invalidateModel("A")).toBe(0);
  });

  it("clear() drops everything and forgets tracked keys", async () => {
    const manager = new CacheManager();

    await manager.set(Q_A1, 1);
    await manager.set(Q_B1, 2);
    await manager.clear();

    expect(await manager.get(Q_A1)).toBeUndefined();
    expect(await manager.get(Q_B1)).toBeUndefined();
    expect(await manager.invalidateModel("A")).toBe(0);
  });
});

describe("CacheManager — statistics (Phase 12)", () => {
  it("merges backend entries/evictions when reported", async () => {
    const manager = new CacheManager({
      backend: new MemoryCache({ maxSize: 1 }),
    });

    await manager.set(Q_A1, 1);
    await manager.set(Q_A2, 2); // evicts Q_A1 (capacity)

    const stats = await manager.stats();
    expect(stats).toMatchObject({
      sets: 2,
      entries: 1,
      evictions: 1,
    });
  });

  it("omits entries/evictions when the backend cannot report them", async () => {
    const manager = new CacheManager({ backend: new ThrowingCache() });

    const stats = await manager.stats();
    expect(stats).toMatchObject({ hits: 0, misses: 0, sets: 0, deletes: 0 });
    expect("entries" in stats).toBe(false);
    expect("evictions" in stats).toBe(false);
  });

  it("resetStats zeroes counters without touching entries", async () => {
    const manager = new CacheManager();

    await manager.set(Q_A1, 1);
    await manager.get(Q_A1);
    manager.resetStats();

    expect(await manager.stats()).toMatchObject({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    });
    expect(await manager.get(Q_A1)).toBe(1); // still cached
  });
});

describe("CacheManager — close", () => {
  it("does not close an injected backend it does not own", async () => {
    let closed = 0;
    const backend = new MemoryCache();
    const manager = new CacheManager({
      backend: {
        ...backend,
        close: async () => {
          closed += 1;
        },
      } satisfies Cache,
    });

    await manager.close();
    expect(closed).toBe(0);
  });
});
