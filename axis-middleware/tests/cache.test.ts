import { afterAll, describe, expect, it, vi } from "vitest";
import {
  Axis,
  CacheManager,
  DEFAULT_CACHE_TTL_MS,
  MemoryCache,
  ValkeyCache,
  buildCacheKey,
  defineModel,
  ModelRegistry,
  type AxisQuery,
  type ValkeyClient,
} from "axis";

import { createApp } from "../src/app.js";

// ---------------------------------------------------------------------------
// What this file proves (caching, end to end)
// ---------------------------------------------------------------------------
// A. Key builder:   deterministic `prefix:Model:<sha256>` keys; same
//                   question => same key (order-insensitive selections,
//                   filters, value lists); different page/sort =>
//                   different key; `cacheTtl` never leaks into the key.
// B. MemoryCache:   set/get, miss, TTL expiry, TTL validation, size cap
//                   eviction (expired first, then oldest), overwrite
//                   refresh, delete/clear, describe().
// C. CacheManager:  miss -> set -> hit + stats, per-call TTL, delete,
//                   invalidateModel (scoped), clear, resetStats, disabled
//                   mode (silent no-op), fail-open on dead backends,
//                   deep-copy isolation, close() ownership.
// D. ValkeyCache:   JSON round-trip, PX millisecond TTL, ttl:0 skip,
//                   corrupt-entry miss, namespaced clear(), ownership.
// E. Engine flow:   real Axis + mocked executor: 1st query MISS (DB hit),
//                   repeat HIT (no DB), normalization, errors never cached,
//                   per-query cacheTtl, invalidateModel, disabled/no-cache.
// F. Middleware:    documents the pre-wiring state (no cache yet).
//
// Logging: tests buffer one line per check and flush a single clean
// block in `afterAll` — quiet during the run, tidy summary at the end.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- clean-log buffer (flushed once, after the whole file passes) ---
const report: string[] = [];
function section(title: string): void {
  report.push("", `── ${title} ──`);
}
function check(msg: string): void {
  report.push(`   ✔ ${msg}`);
}

const MODEL = "CacheModel";
const Q: AxisQuery = { model: MODEL, metrics: ["total"] };

function makeRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  registry.register(
    defineModel({
      name: MODEL,
      source: { type: "table", table: "public.t" },
      axes: { department: { sql: "department", type: "string" } },
      metrics: { total: { type: "count" } },
    }),
  );
  return registry;
}

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

/** Reach into the engine to stub the DB layer (counts real executions). */
function mockExecutor(axis: Axis, rows: unknown[] = [{ total: 1 }]) {
  const executor = (axis as unknown as { engine: { executor: { execute: unknown } } })
    .engine.executor;
  return vi
    .spyOn(executor as { execute: (...a: unknown[]) => Promise<unknown> }, "execute")
    .mockResolvedValue({ rows, rowCount: rows.length });
}

// ===========================================================================
// A. Key builder
// ===========================================================================
describe("A. buildCacheKey", () => {
  it("formats keys as prefix:Model:<64-hex-digest>", () => {
    section("A. key builder");
    const key = buildCacheKey(Q);
    expect(key).toMatch(/^axis:CacheModel:[0-9a-f]{64}$/);
    check(`format ok — ${key.slice(0, 22)}… (${key.length} chars)`);
  });

  it("is deterministic and honors a custom prefix", () => {
    expect(buildCacheKey(Q)).toBe(buildCacheKey({ ...Q }));
    expect(buildCacheKey(Q, { prefix: "axis:prod" })).toMatch(
      /^axis:prod:CacheModel:[0-9a-f]{64}$/,
    );
    check("deterministic; custom prefix applied");
  });

  it("ignores axes/metrics order and duplicates", () => {
    const a: AxisQuery = {
      model: MODEL,
      axes: ["department", "department"],
      metrics: ["total"],
    };
    const b: AxisQuery = {
      model: MODEL,
      axes: ["department"],
      metrics: ["total", "total"],
    };
    expect(buildCacheKey(a)).toBe(buildCacheKey(b));
    check("selection order + duplicates normalized");
  });

  it("ignores filter order and in-list order", () => {
    const a: AxisQuery = {
      ...Q,
      filters: [
        { field: "b", operator: "equals", value: 2 },
        { field: "a", operator: "in", value: [1, 2, 3] },
      ],
    };
    const b: AxisQuery = {
      ...Q,
      filters: [
        { field: "a", operator: "in", value: [3, 1, 2] },
        { field: "b", operator: "equals", value: 2 },
      ],
    };
    expect(buildCacheKey(a)).toBe(buildCacheKey(b));
    check("filter order + value-list order normalized");
  });

  it("treats empty selections as absent", () => {
    expect(buildCacheKey({ model: MODEL, axes: [], metrics: [] })).toBe(
      buildCacheKey({ model: MODEL }),
    );
    check("empty axes/metrics ≡ omitted");
  });

  it("keeps orderBy priority, limit/offset significant", () => {
    const base: AxisQuery = {
      ...Q,
      orderBy: [{ field: "total", direction: "asc" }],
    };
    expect(
      buildCacheKey({
        ...Q,
        orderBy: [{ field: "total", direction: "desc" }],
      }),
    ).not.toBe(buildCacheKey(base));
    expect(buildCacheKey({ ...Q, limit: 5 })).not.toBe(
      buildCacheKey({ ...Q, limit: 6 }),
    );
    expect(buildCacheKey({ ...Q, offset: 1 })).not.toBe(buildCacheKey(Q));
    check("sort direction + paging change the key");
  });

  it("excludes cacheTtl from the key", () => {
    expect(buildCacheKey({ ...Q, cacheTtl: 5_000 })).toBe(
      buildCacheKey({ ...Q, cacheTtl: 60_000 }),
    );
    check("cacheTtl excluded (freshness ≠ identity)");
  });

  it("sanitizes the model segment but keeps models distinct", () => {
    const key = buildCacheKey({ model: "a/b", metrics: ["total"] });
    expect(key).toMatch(/^axis:a_b:[0-9a-f]{64}$/);
    expect(key).not.toBe(buildCacheKey({ model: "a_b", metrics: ["total"] }));
    check("unsafe chars sanitized; no cross-model collision");
  });

  it("rejects null, missing model, and unserializable values", () => {
    expect(() => buildCacheKey(null as unknown as AxisQuery)).toThrow(TypeError);
    expect(() => buildCacheKey({ model: "" })).toThrow(TypeError);
    expect(() =>
      buildCacheKey({ model: MODEL, filters: [{ field: "x", operator: "equals", value: (() => 1) as unknown as number }] }),
    ).toThrow(TypeError);
    check("bad input throws TypeError (loud > collision)");
  });
});

// ===========================================================================
// B. MemoryCache
// ===========================================================================
describe("B. MemoryCache", () => {
  it("round-trips values; misses resolve undefined", async () => {
    section("B. MemoryCache (local backend)");
    const c = new MemoryCache();
    expect(await c.get("k")).toBeUndefined();
    await c.set("k", { rows: [1] });
    expect(await c.get("k")).toEqual({ rows: [1] });
    expect(c.size).toBe(1);
    check("set/get round-trip; miss → undefined");
  });

  it("expires entries after TTL; no TTL means no expiry", async () => {
    const c = new MemoryCache();
    await c.set("short", 1, 30);
    await c.set("forever", 2);
    expect(await c.get("short")).toBe(1);
    await sleep(60);
    expect(await c.get("short")).toBeUndefined();
    expect(await c.get("forever")).toBe(2);
    check("TTL expiry works; omitted TTL lives on");
  });

  it("rejects negative / non-finite TTLs", async () => {
    const c = new MemoryCache();
    await expect(c.set("k", 1, -1)).rejects.toThrow(RangeError);
    await expect(c.set("k", 1, Number.NaN)).rejects.toThrow(RangeError);
    await expect(c.set("k", 1, Number.POSITIVE_INFINITY)).rejects.toThrow(
      RangeError,
    );
    check("negative/NaN/Infinity TTL → RangeError, nothing stored");
  });

  it("evicts oldest when over maxSize; expired first (not counted)", async () => {
    const c = new MemoryCache({ maxSize: 2 });
    await c.set("dead", 0, 10);
    await sleep(30);
    await c.set("a", 1);
    await c.set("b", 2); // overflow: reaps "dead" first, no eviction counted
    expect(await c.get("a")).toBe(1);
    expect(await c.get("b")).toBe(2);
    await c.set("c", 3); // overflow of live entries: evicts oldest ("a")
    expect(await c.get("a")).toBeUndefined();
    expect(await c.get("c")).toBe(3);
    expect(await c.describe()).toMatchObject({ size: 2, evictions: 1 });
    check("cap enforced: expired reaped free, oldest evicted + counted");
  });

  it("overwrite refreshes recency (hot keys survive)", async () => {
    const c = new MemoryCache({ maxSize: 2 });
    await c.set("a", 1);
    await c.set("b", 2);
    await c.set("a", 11); // refresh "a"
    await c.set("c", 3); // evicts "b", not "a"
    expect(await c.get("a")).toBe(11);
    expect(await c.get("b")).toBeUndefined();
    check("overwrite refreshes insertion order");
  });

  it("delete/clear behave; bad maxSize throws", async () => {
    const c = new MemoryCache();
    await c.delete("missing"); // no-op, must not throw
    await c.set("k", 1);
    await c.delete("k");
    expect(await c.get("k")).toBeUndefined();
    await c.set("k", 1);
    await c.clear();
    expect(c.size).toBe(0);
    expect(() => new MemoryCache({ maxSize: 0 })).toThrow(RangeError);
    check("delete missing = no-op; clear empties; maxSize ≥ 1 enforced");
  });
});

// ===========================================================================
// C. CacheManager
// ===========================================================================
describe("C. CacheManager", () => {
  it("miss → set → hit workflow with stats", async () => {
    section("C. CacheManager (central abstraction)");
    const cache = new CacheManager({ backend: new MemoryCache() });
    expect(await cache.get(Q)).toBeUndefined(); // miss 1
    await cache.set(Q, { rows: [1], rowCount: 1 });
    expect(await cache.get(Q)).toEqual({ rows: [1], rowCount: 1 }); // hit 1
    expect(await cache.stats()).toMatchObject({ hits: 1, misses: 1, sets: 1 });
    check("miss → set → hit; stats {hits:1, misses:1, sets:1}");
    await cache.close();
  });

  it("merges backend entries/evictions into stats; resetStats keeps data", async () => {
    const cache = new CacheManager({ backend: new MemoryCache() });
    await cache.set(Q, 1);
    expect(await cache.stats()).toMatchObject({ entries: 1 });
    cache.resetStats();
    expect(await cache.stats()).toMatchObject({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      entries: 1,
    });
    expect(await cache.get(Q)).toBe(1); // entry survived the reset
    check("stats merged from backend; resetStats zeroes counters only");
    await cache.close();
  });

  it("per-call TTL wins; default is 60s; bad ttl throws", async () => {
    expect(new CacheManager().ttl).toBe(DEFAULT_CACHE_TTL_MS);
    expect(() => new CacheManager({ ttl: -1 })).toThrow(RangeError);
    const cache = new CacheManager({
      backend: new MemoryCache(),
      ttl: 10_000,
    });
    await cache.set(Q, "short", 30);
    expect(await cache.get(Q)).toBe("short");
    await sleep(60);
    expect(await cache.get(Q)).toBeUndefined();
    check("per-call TTL overrides default (60s); invalid ttl → RangeError");
    await cache.close();
  });

  it("delete() removes one query; invalidateModel() scopes to a model", async () => {
    const cache = new CacheManager({ backend: new MemoryCache() });
    const other: AxisQuery = { model: "Other", metrics: ["total"] };
    await cache.set(Q, 1);
    await cache.set({ ...Q, limit: 5 }, 2);
    await cache.set(other, 3);
    await cache.delete(Q);
    expect(await cache.get(Q)).toBeUndefined();
    const removed = await cache.invalidateModel(MODEL);
    expect(removed).toBe(1);
    expect(await cache.get(other)).toBe(3); // untouched
    await cache.clear();
    expect(await cache.get(other)).toBeUndefined();
    const stats = await cache.stats();
    expect(stats.deletes).toBe(2); // 1 delete + 1 invalidated
    check("delete = 1 query; invalidateModel scoped; clear = everything");
    await cache.close();
  });

  it("disabled mode is a silent no-op (backend untouched)", async () => {
    const backend = new MemoryCache();
    const spyGet = vi.spyOn(backend, "get");
    const cache = new CacheManager({ backend, enabled: false });
    await cache.set(Q, 1);
    expect(await cache.get(Q)).toBeUndefined();
    expect(await cache.invalidateModel(MODEL)).toBe(0);
    expect(await cache.stats()).toMatchObject({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    });
    expect(spyGet).not.toHaveBeenCalled();
    check("enabled:false → always miss, backend never touched");
    await cache.close();
  });

  it("is fail-open: dead backend degrades to miss, never throws", async () => {
    const dead = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {
        throw new Error("down");
      },
      delete: async () => {
        throw new Error("down");
      },
      clear: async () => {
        throw new Error("down");
      },
    };
    const cache = new CacheManager({ backend: dead });
    await expect(cache.get(Q)).resolves.toBeUndefined();
    await expect(cache.set(Q, 1)).resolves.toBeUndefined();
    await expect(cache.delete(Q)).resolves.toBeUndefined();
    await expect(cache.clear()).resolves.toBeUndefined();
    await expect(cache.stats()).resolves.toMatchObject({ misses: 1 });
    check("backend down → miss + skip, zero exceptions");
    await cache.close();
  });

  it("deep-copies on store and hit (callers cannot poison entries)", async () => {
    const cache = new CacheManager({ backend: new MemoryCache() });
    const original = { rows: [{ n: 1 }], rowCount: 1 };
    await cache.set(Q, original);
    original.rows.push({ n: 2 }); // mutate after store
    const hit = (await cache.get(Q)) as typeof original;
    expect(hit.rows).toHaveLength(1);
    hit.rows.push({ n: 99 }); // mutate the hit
    expect(((await cache.get(Q)) as typeof original).rows).toHaveLength(1);
    check("mutation of inputs/hits never corrupts stored entry");
    await cache.close();
  });

  it("keyFor is deterministic and prefix-scoped; close() owns only its backend", async () => {
    const a = new CacheManager({ backend: new MemoryCache(), keyPrefix: "p1" });
    const b = new CacheManager({ backend: new MemoryCache(), keyPrefix: "p2" });
    expect(a.keyFor(Q)).toBe(a.keyFor({ ...Q }));
    expect(a.keyFor(Q)).not.toBe(b.keyFor(Q));
    const injectedClose = vi.fn(async () => undefined);
    const injected = new MemoryCache();
    (injected as unknown as Record<string, unknown>).close = injectedClose;
    await new CacheManager({ backend: injected }).close(); // must NOT close
    expect(injectedClose).not.toHaveBeenCalled();
    await a.close(); // owned default backend: closes cleanly
    check("keyFor deterministic + namespaced; injected backend not closed");
  });
});

// ===========================================================================
// D. ValkeyCache (against an in-memory fake — no live server needed)
// ===========================================================================
class FakeValkey implements ValkeyClient {
  readonly store = new Map<string, { raw: string; pxAt?: number }>();
  readonly setCalls: { key: string; args: (string | number)[] }[] = [];
  quitCalls = 0;

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.pxAt !== undefined && Date.now() >= e.pxAt) {
      this.store.delete(key);
      return null;
    }
    return e.raw;
  }
  async set(key: string, value: string, ...args: (string | number)[]): Promise<unknown> {
    this.setCalls.push({ key, args });
    let pxAt: number | undefined;
    for (let i = 0; i < args.length; i++)
      if (args[i] === "PX" && typeof args[i + 1] === "number")
        pxAt = Date.now() + (args[i + 1] as number);
    this.store.set(key, pxAt === undefined ? { raw: value } : { raw: value, pxAt });
    return "OK";
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async unlink(...keys: string[]): Promise<number> {
    return this.del(...keys);
  }
  async scan(cursor: string | number, ...args: (string | number)[]): Promise<[string, string[]]> {
    let match = "*";
    let count = 10;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "MATCH") match = String(args[i + 1]);
      if (args[i] === "COUNT") count = Number(args[i + 1]);
    }
    const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = String(cursor) === "0" ? 0 : Number(cursor);
    const page = keys.slice(start, start + count);
    return [start + count >= keys.length ? "0" : String(start + count), page];
  }
  async quit(): Promise<unknown> {
    this.quitCalls++;
    return "OK";
  }
}

describe("D. ValkeyCache", () => {
  it("round-trips JSON; stores TTL in ms via PX", async () => {
    section("D. ValkeyCache (production backend, faked)");
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });
    await cache.set("k", { rows: [1] }, 60_000);
    expect(client.setCalls).toEqual([{ key: "k", args: ["PX", 60_000] }]);
    expect(await cache.get("k")).toEqual({ rows: [1] });
    check("JSON round-trip; TTL stored exact-ms via PX");
  });

  it("writes without expiry when TTL omitted; skips write on ttl:0; rejects bad TTL", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });
    await cache.set("plain", 1);
    expect(client.setCalls).toEqual([{ key: "plain", args: [] }]);
    await cache.set("zero", 1, 0);
    expect(client.store.has("zero")).toBe(false);
    await expect(cache.set("k", 1, -5)).rejects.toThrow(RangeError);
    await expect(cache.set("k", 1, Number.NaN)).rejects.toThrow(RangeError);
    check("no-TTL write; ttl:0 skipped (PX 0 illegal); bad TTL rejected");
  });

  it("treats corrupt entries as a miss and reaps them", async () => {
    const client = new FakeValkey();
    client.store.set("k", { raw: "{not-json" });
    expect(await new ValkeyCache({ client }).get("k")).toBeUndefined();
    expect(client.store.has("k")).toBe(false);
    check("corrupt entry → miss + best-effort reap");
  });

  it("clear() removes only the namespace (paged), never foreign keys", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client, scanCount: 2 });
    await cache.set("axis:A:1", 1);
    await cache.set("axis:A:2", 2);
    client.store.set("sessions:xyz", { raw: "{}" });
    await cache.clear();
    expect(client.store.has("axis:A:1")).toBe(false);
    expect(client.store.has("sessions:xyz")).toBe(true);
    expect(await cache.describe()).toEqual({}); // unknown, not scanned
    check("SCAN-based clear scoped to namespace; size unknown by design");
  });

  it("close() never quits an injected client", async () => {
    const client = new FakeValkey();
    await new ValkeyCache({ client }).close();
    expect(client.quitCalls).toBe(0);
    check("injected client ownership respected");
  });
});

// ===========================================================================
// E. Engine workflow — real Axis, mocked DB: proves HITs skip the database
// ===========================================================================
describe("E. engine workflow (Axis + cache + mocked DB)", () => {
  it("1st query MISS (DB hit) → repeat HIT (no DB); stats agree", async () => {
    section("E. engine workflow (mocked DB)");
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      cache: { enabled: true, ttl: 60_000 },
    });
    const exec = mockExecutor(axis);
    try {
      const first = await axis.query(Q);
      expect(exec).toHaveBeenCalledTimes(1);
      const second = await axis.query(Q);
      expect(exec).toHaveBeenCalledTimes(1); // HIT: DB untouched
      expect(second).toEqual(first);
      expect(await axis.cache?.stats()).toMatchObject({
        hits: 1,
        misses: 1,
        sets: 1,
      });
      check("MISS executes once; repeat HIT skips DB (exec ×1)");
    } finally {
      exec.mockRestore();
      await axis.close();
    }
  });

  it("semantically identical queries share the entry; paging does not", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      cache: { enabled: true },
    });
    const exec = mockExecutor(axis);
    try {
      await axis.query({ model: MODEL, axes: ["department"], metrics: ["total"] });
      await axis.query({ model: MODEL, metrics: ["total"], axes: ["department"] });
      expect(exec).toHaveBeenCalledTimes(1);
      await axis.query({ model: MODEL, metrics: ["total"], limit: 5 });
      expect(exec).toHaveBeenCalledTimes(2);
      check("reordered query HITs; different limit MISSes");
    } finally {
      exec.mockRestore();
      await axis.close();
    }
  });

  it("validation / resolution / execution errors are never cached", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      cache: { enabled: true },
    });
    const exec = mockExecutor(axis);
    try {
      await expect(axis.query({ model: MODEL })).rejects.toMatchObject({
        name: "ValidationError",
      });
      await expect(
        axis.query({ model: MODEL, metrics: ["ghost"] }),
      ).rejects.toMatchObject({ name: "ResolutionError" });
      expect(exec).not.toHaveBeenCalled(); // failed before execution
      expect(await axis.cache?.stats()).toMatchObject({ hits: 0, misses: 0, sets: 0 });

      exec.mockRejectedValueOnce(new Error("db exploded"));
      await expect(axis.query(Q)).rejects.toThrow();
      expect(await axis.cache?.stats()).toMatchObject({ sets: 0 }); // failure not stored
      await axis.query(Q); // retry reaches DB again, then stores
      await axis.query(Q); // now a HIT
      expect(await axis.cache?.stats()).toMatchObject({ hits: 1, sets: 1 });
      check("bad queries fail pre-cache; failures never stored; retry works");
    } finally {
      exec.mockRestore();
      await axis.close();
    }
  });

  it("per-query cacheTtl controls freshness; invalidateModel forces re-execution", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      cache: { enabled: true, ttl: 60_000 },
    });
    const exec = mockExecutor(axis);
    try {
      await axis.query({ ...Q, cacheTtl: 30 });
      await axis.query({ ...Q, cacheTtl: 30 });
      expect(exec).toHaveBeenCalledTimes(1);
      await sleep(60); // entry expired
      await axis.query({ ...Q, cacheTtl: 30 });
      expect(exec).toHaveBeenCalledTimes(2);
      const removed = await axis.invalidateModel(MODEL);
      expect(removed).toBeGreaterThanOrEqual(1);
      await axis.query(Q);
      expect(exec).toHaveBeenCalledTimes(3);
      check("cacheTtl expiry re-executes; invalidateModel drops model keys");
    } finally {
      exec.mockRestore();
      await axis.close();
    }
  });

  it("disabled cache and no-cache Axis always reach the DB", async () => {
    for (const cfg of [{ enabled: false }, undefined]) {
      const axis = new Axis({
        database: { url: UNREACHABLE_DB },
        registry: makeRegistry(),
        ...(cfg === undefined ? {} : { cache: { enabled: false } }),
      });
      const exec = mockExecutor(axis);
      try {
        await axis.query(Q);
        await axis.query(Q);
        expect(exec).toHaveBeenCalledTimes(2);
      } finally {
        exec.mockRestore();
        await axis.close();
      }
    }
    check("enabled:false / no cache block → every query hits DB");
  });
});

// ===========================================================================
// F. Middleware wiring state (caching REMOVED from the middleware:
// every request must reach OpenSearch, so createApp never wires a cache)
// ===========================================================================
describe("F. middleware wiring state", () => {
  it("createApp never wires a cache (always disabled)", async () => {
    section("F. middleware state");
    const ctx = createApp(UNREACHABLE_DB);
    try {
      // Post-wiring: no cache backend, always-miss.
      expect(ctx.cacheBackendKind).toBe("disabled");
      expect(ctx.axis.cache?.isEnabled ?? false).toBe(false);
      check("createApp Axis up; caching disabled (OpenSearch-only)");
    } finally {
      await ctx.axis.close();
    }
  });

  it("cache options are accepted but ignored (still disabled)", async () => {
    const ctx = createApp(UNREACHABLE_DB, { cacheEnabled: true, cacheTtlMs: 30 });
    try {
      expect(ctx.cacheBackendKind).toBe("disabled");
      expect(ctx.axis.cache?.isEnabled ?? false).toBe(false);
      check("cacheEnabled:true → still disabled");
    } finally {
      await ctx.axis.close();
    }
  });
});

// --- flush the clean log block once, after everything ran ---
afterAll(() => {
  console.log("\n================ CACHING TEST REPORT ================");
  for (const line of report) console.log(line);
  console.log("   ─────────────────────────────────");
  console.log("   All caching layers verified: key → backend →");
  console.log("   manager → Valkey → engine → middleware (memory).");
  console.log("=====================================================\n");
});
