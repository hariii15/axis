import { describe, expect, it } from "vitest";

import { CacheManager } from "../../src/core/cache/cache-manager.js";
import { MemoryCache } from "../../src/core/cache/memory-cache.js";
// NOTE: ValkeyCache / ValkeyClient configuration in
// `src/core/cache/valkey-cache.ts` is intentionally left as-is.
// This demo proves the same CacheManager + query-engine middleware path
// works with the in-memory backend, so no live Valkey server is needed.
import type { Database } from "../../src/core/database/database.js";
import { AxisQueryEngine } from "../../src/core/query-engine/query-engine.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import type { AxisQuery } from "../../src/core/query/types.js";

const Orders = defineModel({
  name: "Orders",
  source: { type: "table", table: "public.orders" },
  axes: {
    status: { sql: "status", type: "string" },
  },
  metrics: {
    total: { type: "count" },
  },
});

/** Fake DB: scripted result + execution counter to prove cache hits. */
class FakeDatabase {
  calls = 0;
  async query(): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls += 1;
    return { rows: [{ total: 7 }], rowCount: 1 };
  }
  asDatabase(): Database {
    return this as unknown as Database;
  }
}

function engineWithInMemoryCache(db: FakeDatabase): {
  engine: AxisQueryEngine;
  cache: CacheManager;
} {
  const registry = new ModelRegistry();
  registry.register(Orders);
  // Middleware wiring under test: CacheManager + MemoryCache (not Valkey).
  const cache = new CacheManager({
    backend: new MemoryCache({ maxSize: 100 }),
    ttl: 60_000,
  });
  return { engine: new AxisQueryEngine(db.asDatabase(), registry, cache), cache };
}

const Q: AxisQuery = { model: "Orders", metrics: ["total"] };

describe("In-memory cache middleware demo (no Valkey needed)", () => {
  it("MISS executes once, repeat HIT serves without re-executing", async () => {
    const db = new FakeDatabase();
    const { engine, cache } = engineWithInMemoryCache(db);

    console.log("--- 1st query (expected MISS) ---");
    const first = await engine.query(Q);
    console.log("rows:", first.rows, "| db.calls:", db.calls);

    console.log("--- 2nd identical query (expected HIT) ---");
    const second = await engine.query({ ...Q });
    console.log("rows:", second.rows, "| db.calls:", db.calls);
    console.log("stats:", await cache.stats());

    expect(db.calls).toBe(1);
    expect(second).toEqual(first);
    expect(await cache.stats()).toMatchObject({ hits: 1, misses: 1, sets: 1 });
  });

  it("different query shape bypasses the cached entry", async () => {
    const db = new FakeDatabase();
    const { engine } = engineWithInMemoryCache(db);

    await engine.query(Q);
    await engine.query({ model: "Orders", axes: ["status"], metrics: ["total"] });

    expect(db.calls).toBe(2);
  });

  it("invalidateModel drops the in-memory entry so the next query re-executes", async () => {
    const db = new FakeDatabase();
    const { engine, cache } = engineWithInMemoryCache(db);

    await engine.query(Q);
    expect(await cache.invalidateModel("Orders")).toBe(1);
    await engine.query(Q);

    expect(db.calls).toBe(2);
  });
});
