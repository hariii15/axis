import { describe, expect, it } from "vitest";

import { Axis } from "../../src/core/axis.js";
import type { Database } from "../../src/core/database/database.js";
import { CacheManager } from "../../src/core/cache/cache-manager.js";
import { MemoryCache } from "../../src/core/cache/memory-cache.js";
import type { Cache } from "../../src/core/cache/types.js";
import { AxisQueryEngine } from "../../src/core/query-engine/query-engine.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import type { AxisQuery } from "../../src/core/query/types.js";

const TestModel = defineModel({
  name: "Orders",
  source: { type: "table", table: "public.orders" },
  axes: {
    status: { sql: "status", type: "string" },
  },
  metrics: {
    total: { type: "count" },
  },
});

function testRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  registry.register(TestModel);
  return registry;
}

/** Fake database: scripted results, records every execution. */
class FakeDatabase {
  calls = 0;
  private queue: Array<{ rows: unknown[] } | { error: Error }> = [];

  enqueueResult(rows: unknown[]): void {
    this.queue.push({ rows });
  }

  enqueueError(error: Error): void {
    this.queue.push({ error });
  }

  async query(): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls += 1;
    const next = this.queue.shift();
    if (next === undefined) {
      return { rows: [{ total: 7 }], rowCount: 1 };
    }
    if ("error" in next) {
      throw next.error;
    }
    return { rows: next.rows, rowCount: next.rows.length };
  }

  asDatabase(): Database {
    return this as unknown as Database;
  }
}

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

class RecordingCache extends MemoryCache {
  public ttls: (number | undefined)[] = [];
  override async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.ttls.push(ttl);
    return super.set(key, value, ttl);
  }
}

const Q: AxisQuery = { model: "Orders", metrics: ["total"] };

function engineWith(
  db: FakeDatabase,
  manager: CacheManager | undefined,
): AxisQueryEngine {
  return new AxisQueryEngine(db.asDatabase(), testRegistry(), manager);
}

describe("QueryEngine + cache (Phase 10)", () => {
  it("miss executes once, repeat hits without re-executing", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(db, new CacheManager());

    const first = await engine.query(Q);
    const second = await engine.query({ ...Q });

    expect(db.calls).toBe(1);
    expect(second).toEqual(first);
    expect(await engine.getCache()?.stats()).toMatchObject({
      hits: 1,
      misses: 1,
      sets: 1,
    });
  });

  it("different queries execute independently", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(db, new CacheManager());

    await engine.query(Q);
    await engine.query({ model: "Orders", axes: ["status"] });

    expect(db.calls).toBe(2);
  });

  it("errors are never cached and never served", async () => {
    const db = new FakeDatabase();
    db.enqueueError(new Error("boom"));
    const engine = engineWith(db, new CacheManager());

    await expect(engine.query(Q)).rejects.toThrow(
      /Failed to execute compiled query/,
    );
    const ok = await engine.query(Q); // executes again, succeeds…
    expect(ok.rows).toEqual([{ total: 7 }]);
    await engine.query(Q); // …now served from cache

    expect(db.calls).toBe(2);
    expect(await engine.getCache()?.stats()).toMatchObject({ sets: 1 });
  });

  it("validation errors bypass the cache entirely", async () => {
    const db = new FakeDatabase();
    const manager = new CacheManager();
    const engine = engineWith(db, manager);

    await expect(engine.query({ model: "Orders" })).rejects.toThrow();
    expect(db.calls).toBe(0);
    expect(await manager.stats()).toMatchObject({
      hits: 0,
      misses: 0,
      sets: 0,
    });
  });

  it("unknown models fail before any cache interaction", async () => {
    const db = new FakeDatabase();
    const manager = new CacheManager();
    const engine = engineWith(db, manager);

    await expect(
      engine.query({ model: "Ghost", metrics: ["total"] }),
    ).rejects.toThrow(/not registered/i);
    expect(db.calls).toBe(0);
    expect(await manager.stats()).toMatchObject({
      hits: 0,
      misses: 0,
      sets: 0,
    });
  });

  it("rejects an invalid per-query cacheTtl with a validation error", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(db, new CacheManager());

    await expect(
      engine.query({ model: "Orders", metrics: ["total"], cacheTtl: -5 }),
    ).rejects.toThrow();
    expect(db.calls).toBe(0);
  });

  it("forwards per-query cacheTtl to the backend", async () => {
    const db = new FakeDatabase();
    const backend = new RecordingCache();
    const engine = engineWith(
      db,
      new CacheManager({ backend, ttl: 60_000 }),
    );

    await engine.query({ ...Q, cacheTtl: 5_000 });
    await engine.query({ model: "Orders", axes: ["status"], cacheTtl: 100 });

    expect(backend.ttls).toEqual([5_000, 100]);
  });

  it("a dead cache backend never breaks queries (fail-open)", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(
      db,
      new CacheManager({ backend: new ThrowingCache() }),
    );

    const first = await engine.query(Q);
    const second = await engine.query(Q);

    expect(second).toEqual(first);
    expect(db.calls).toBe(2); // no caching, but no errors either
  });

  it("a disabled manager executes every time", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(db, new CacheManager({ enabled: false }));

    await engine.query(Q);
    await engine.query(Q);

    expect(db.calls).toBe(2);
  });

  it("mutating a result never poisons later hits", async () => {
    const db = new FakeDatabase();
    const engine = engineWith(db, new CacheManager());

    const first = await engine.query<{ total: number }>(Q);
    first.rows.push({ total: 999 });

    const second = await engine.query(Q);
    expect(second.rows).toEqual([{ total: 7 }]);
  });

  it("works with no manager at all (backward compatible)", async () => {
    const db = new FakeDatabase();
    const engine = new AxisQueryEngine(db.asDatabase(), testRegistry());

    expect(engine.getCache()).toBeUndefined();
    await engine.query(Q);
    await engine.query(Q);
    expect(db.calls).toBe(2);
  });
});

describe("Axis cache wiring", () => {
  const url = "postgres://127.0.0.1:1/postgres";

  it("exposes the manager, stats and invalidation when configured", async () => {
    const axis = new Axis({
      database: { url },
      cache: { enabled: true, ttl: 30_000 },
    });

    expect(axis.cache).toBeInstanceOf(CacheManager);
    expect(axis.cache?.ttl).toBe(30_000);
    expect(await axis.invalidateModel("Orders")).toBe(0);
    expect(await axis.cache?.stats()).toMatchObject({ hits: 0 });
    await axis.close();
  });

  it("has no manager when `cache` is omitted", async () => {
    const axis = new Axis({ database: { url } });

    expect(axis.cache).toBeUndefined();
    expect(await axis.invalidateModel("Orders")).toBe(0);
    await axis.close();
  });

  it("accepts a prebuilt manager", async () => {
    const manager = new CacheManager({ ttl: 1_000 });
    const axis = new Axis({ database: { url }, cache: { manager } });

    expect(axis.cache).toBe(manager);
    await axis.close();
  });

  it("accepts a Valkey-style backend through config", async () => {
    const axis = new Axis({
      database: { url },
      cache: { enabled: true, ttl: 60_000, backend: new ThrowingCache() },
    });

    // Fail-open even with a dead backend: resolution still throws
    // for unknown models before execution is attempted.
    await expect(
      axis.query({ model: "Ghost", metrics: ["total"] }),
    ).rejects.toThrow(/not registered/i);
    await axis.close();
  });
});
