# Axis — Caching

How query results are cached, why it works this way, and how to configure it

Dashboards ask the same questions over and over: *"pending requisitions by department"*, refreshed every few seconds by every open tab. Without caching, each of those repeats the full trip — validate, resolve, compile SQL, hit Postgres, serialize rows.

Axis caching sits **between resolution and execution**: the first identical query runs against Postgres and its result is stored; repeats are served from the store without touching the database at all.

> **The golden rule:** caching is a pure performance layer. It never changes *what* a query returns or *which* errors surface — only *how fast* repeated queries answer. If the cache backend dies, queries keep working, just slower. That property is called **fail-open**, and it is designed into every layer below.

## Table of Contents

1. [How a query flows through the cache](#1-how-a-query-flows-through-the-cache)
2. [Architecture: the pieces and their files](#2-architecture-the-pieces-and-their-files)
3. [The Cache interface (the pluggable contract)](#3-the-cache-interface-the-pluggable-contract)
4. [Cache keys: format and normalization](#4-cache-keys-format-and-normalization)
5. [MemoryCache (local backend)](#5-memorycache-local-backend)
6. [CacheManager (the central abstraction)](#6-cachemanager-the-central-abstraction)
7. [TTL: how long entries live](#7-ttl-how-long-entries-live)
8. [Statistics: observing the cache](#8-statistics-observing-the-cache)
9. [Invalidation: forgetting on purpose](#9-invalidation-forgetting-on-purpose)
10. [Engine integration: where caching hooks in](#10-engine-integration-where-caching-hooks-in)
11. [ValkeyCache (production backend)](#11-valkeycache-production-backend)
12. [Configuration reference](#12-configuration-reference)
13. [Wiring it into the middleware](#13-wiring-it-into-the-middleware)
14. [FAQ](#14-faq)

---

## 1. How a query flows through the cache

Every `axis.query()` with caching configured follows this path:

```
Query
 ↓
Validate ── invalid? ──▶ ValidationError (never cached, never stored)
 ↓
Resolve ─── unknown model/axis/metric? ──▶ ResolutionError (never cached)
 ↓
Cache Key (buildCacheKey)
 ↓
CacheManager.get()
 ↓
 ├── HIT  → return stored Result (no SQL, no database)
 │
 └── MISS ──▶ Compile → Database → CacheManager.set() → Result
```

Three decisions in that diagram are deliberate:

- **The cache is consulted after validation and resolution.** Typos and bad shapes fail exactly as they do with caching off — and, just as importantly, failures are never written into the cache.
- **Only successful results are stored.** A database error runs, throws, and leaves no trace in the cache, so the next retry hits Postgres again instead of replaying a failure.
- **Every cache interaction is fail-open.** Backend down, corrupt entry, unbuildable key — the query falls through to Postgres. Caching can only ever cost performance when broken, never correctness.

---

## 2. Architecture: the pieces and their files

All caching code lives in `src/core/cache/` inside the `axis` package. Each piece has exactly one job:

| Piece | File | Job |
|-------|------|-----|
| `Cache` / `CacheInfo` | `types.ts` | The pluggable contract every backend implements. Axis never talks to a concrete store. |
| `buildCacheKey` | `key-builder.ts` | Turns a query into a fixed-length, Valkey-safe key. Semantically identical queries share a key. |
| `MemoryCache` | `memory-cache.ts` | In-process `Map` backend for local dev and single-instance use. |
| `CacheManager` | `cache-manager.ts` | Central abstraction: key generation → lookup → hit/miss → store, plus stats and invalidation. |
| `ValkeyCache` | `valkey-cache.ts` | Production backend over Valkey/Redis via `ioredis`. Interchangeable with `MemoryCache`. |
| Engine hook | `query-engine/query-engine.ts` | Consults the manager after resolution, stores after execution. No manager wired → zero behavior change. |
| Config + access | `core/axis.ts` (`CacheConfig`) | Builds the manager from `cache: { enabled, ttl, backend, manager }`; exposes `axis.cache`. |

Dependency direction is strict: the engine and `Axis` only know `CacheManager`; the manager only knows the `Cache` interface plus the key builder. Nothing above the manager imports `MemoryCache` or `ValkeyCache` — that is what makes backends pluggable.

---

## 3. The Cache interface (the pluggable contract)

This is the entire surface a storage backend must implement — four required methods, two optional:

```typescript
interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  describe?(): CacheInfo | Promise<CacheInfo>; // optional stats
  close?(): Promise<void>;                     // optional cleanup
}
```

| Method | Contract |
|--------|----------|
| `get` | Returns the stored value or `undefined` on miss (absent, expired, or corrupt). Never throws for a plain miss. |
| `set` | Stores `value` under `key`. `ttl` is **milliseconds**; missing means "no expiry". Must reject negative or non-finite TTLs instead of storing instantly-dead entries. |
| `delete` | Removes one key. Deleting a missing key is a no-op. |
| `clear` | Removes everything this cache owns. Must never wipe data outside its own namespace (see Valkey below). |
| `describe?` | Optional introspection (`{ size?, evictions? }`). Absence means "unknown" — callers must cope without it. |
| `close?` | Optional resource release (sockets). Absence means "nothing to release". |

> **Why an interface, not a class?** Because the day you outgrow one store, you swap the backend, not the library. `MemoryCache` today, `ValkeyCache` tomorrow, a `DragonflyCache` later — the manager, the engine, and your application code stay untouched. That is Phase 14, and it is already the foundation everything else is built on.

---

## 4. Cache keys: format and normalization

`buildCacheKey(query)` produces keys shaped like this:

```
axis:PurchaseRequisitions:9f2c…a41b
# │    │                      │
# │    │                      └── sha256 of the normalized query (64 hex chars)
# │    └───────────────────────── plaintext model segment
# └────────────────────────────── namespace prefix (configurable)
```

Each part earns its place:

- **Fixed length.** Only the digest varies with query complexity, so Valkey memory stays predictable no matter how large a filter list gets.
- **Plaintext model segment.** Lets operators inspect and invalidate per model (`SCAN axis:PurchaseRequisitions:*`). The *raw* model name is also inside the hashed payload, so two models that sanitize to the same segment can never collide.
- **Sanitized segments.** Anything outside `[A-Za-z0-9_.-]` becomes `_`, keeping keys safe for Valkey tooling.

### Normalization: same question, same key

Two queries that mean the same thing must share an entry, or the hit rate collapses. The builder canonicalizes before hashing:

| Input difference | Same key? | Why |
|------------------|-----------|-----|
| Axes / metrics in different order | Yes | Selection order is insignificant — de-duplicated and sorted. |
| Filters in different order | Yes | AND is commutative — sorted by full canonical form (including values, not just field names). |
| `in: [1,2,3]` vs `in: [3,1,2]` | Yes | Value-list order is insignificant — sorted. |
| `axes: []` vs omitted | Yes | Empty selections are treated as absent. |
| Different `orderBy` order or direction | No | Sort priority is significant — order preserved deliberately. |
| Different `limit` / `offset` | No | Different pages are different answers. |
| Different `cacheTtl` | Yes | TTL controls freshness, not content — excluded from the key. |

Two subtle correctness details: string comparison uses code-unit order rather than `localeCompare` (which varies by host ICU data and would make the same query hash differently on different machines), and `NaN` / `±Infinity` get their own tokens instead of colliding with `null` as they do under `JSON.stringify`. Unserializable values (functions, symbols) throw a `TypeError` — failing loud beats a silent collision.

---

## 5. MemoryCache (local backend)

An in-process `Map` with coherent TTL and a size cap. Zero setup, zero network — the right default for development and single-instance deployments.

```typescript
import { MemoryCache } from "axis";

const backend = new MemoryCache({ maxSize: 1000 }); // default 1000
await backend.set("axis:M:abc", result, 60_000);    // ttl in ms
await backend.get("axis:M:abc");                    // value or undefined
console.log(backend.size);                          // entries currently held
```

### Eviction policy

When a write would exceed `maxSize`, the cache evicts in two passes and stops as soon as the cap is met (work stays proportional to the overflow, not the whole map):

1. **Expired entries first** — they are garbage anyway. These do *not* count as evictions.
2. **Oldest-inserted entries** — the `Map` preserves insertion order, so iteration starts at the oldest. Each of these increments the eviction counter.

Overwriting a key refreshes its recency (delete-then-set), so a hot key is not evicted as "oldest". Expired entries are also reaped lazily on `get`. Introspection via `describe()` reports `{ size, evictions }`, which the manager merges into its statistics.

> **Limit to know:** it lives in one Node process. Multi-instance deployments need `ValkeyCache` so every instance shares one cache — otherwise each server builds (and misses) its own.

---

## 6. CacheManager (the central abstraction)

The manager owns the full lifecycle — *key generation → lookup → hit/miss → store* — plus statistics and invalidation. The engine never touches a backend directly; application code shouldn't either.

```typescript
import { CacheManager } from "axis";

const cache = new CacheManager({
  backend: new MemoryCache(), // default; any Cache works
  ttl: 60_000,                // default TTL in ms
  enabled: true,              // master switch
  keyPrefix: "axis",          // key namespace
});

await cache.set(query, result);          // store with default TTL
await cache.set(query, result, 5_000);   // …or override per call
await cache.get(query);                  // hit value or undefined
await cache.delete(query);               // forget one exact query
await cache.invalidateModel("PurchaseRequisitions"); // forget one model
await cache.clear();                     // forget everything
await cache.stats();                     // { hits, misses, sets, deletes, … }
cache.resetStats();                      // zero counters, keep entries
await cache.close();                     // release owned backend resources
```

| Method | What it does |
|--------|--------------|
| `keyFor(query)` | Deterministic key via `buildCacheKey` with the manager's prefix. Same query → same key, always. |
| `get(query)` | Hit value or `undefined`. Counts a hit or miss. Backend failures, corrupt entries, and unbuildable keys all degrade to a miss. |
| `set(query, value, ttl?)` | Stores with per-call TTL or the manager default. Tracks the key under its model for later invalidation. Never throws. |
| `delete(query)` | Removes one exact query's entry and untracks it. Counts a delete. Never throws. |
| `invalidateModel(model)` | Deletes every tracked key for one model; returns the removal count. The targeted alternative to `clear()`. |
| `clear()` | Drops everything and forgets all tracked keys across all models. |
| `stats()` / `resetStats()` | Snapshot of counters (+ backend info when reported) / zero counters without touching entries. |
| `close()` | Closes the backend only if the manager created it — an injected backend stays the caller's own. |

### Two guarantees worth knowing

- **Callers can never poison the cache by mutation.** Values are deep-copied (`structuredClone`, with a reference fallback) on both store and hit. Mutating the object you passed to `set`, or the object a hit returned, cannot corrupt later reads. Remote backends already isolate via JSON serialization; the copy keeps in-process backends to the same contract.
- **Disabled means untouched.** With `enabled: false`, every method is a silent no-op — `get` always misses, nothing reaches the backend, and no counters move. Useful for kill-switches and tests.

---

## 7. TTL: how long entries live

Every TTL in Axis is **milliseconds**. Three levels decide an entry's lifetime, highest precedence first:

| Level | Where | Default |
|-------|-------|---------|
| Per-query `cacheTtl` | On the query itself: `{ model, metrics, cacheTtl: 5_000 }`. Validated like any other field, carried through the engine into `manager.set`. | — (falls through) |
| Manager default | `new CacheManager({ ttl })` or `new Axis({ cache: { ttl } })`. | `60_000` (1 minute) |
| No expiry | Omit TTL at every level (manager default can only be omitted via a custom manager path). | Entries live until evicted or invalidated |

Validation is strict everywhere: negative, `NaN`, or infinite TTLs throw `RangeError` instead of storing instantly-dead entries. `ttl: 0` means "already expired" — `MemoryCache` expires it on next read, while `ValkeyCache` skips the write entirely (Valkey rejects `PX 0`).

> **How to think about TTLs:** dashboard aggregates refresh every minute or so — a 30–60s TTL absorbs repeated polls while staying fresh. Slowly-changing dimensions can use minutes; per-query `cacheTtl` covers the exceptions (a rarely-changing report at 10 minutes, a live counter at 5 seconds).

---

## 8. Statistics: observing the cache

`await cache.stats()` returns a snapshot shaped like this:

```json
{
  "hits": 120,      // served from cache
  "misses": 35,     // fell through to Postgres (incl. backend failures)
  "sets": 35,       // entries written
  "deletes": 7,     // single deletes + invalidated entries
  "entries": 28,    // currently held — only if the backend reports it
  "evictions": 7    // capacity-driven removals — only if reported
}
```

- **Hits/misses/sets/deletes** are owned by the manager and always present. A useful derived metric is the hit ratio: `hits / (hits + misses)`.
- **Entries/evictions** are merged from `backend.describe()` when available. `MemoryCache` reports both; `ValkeyCache` reports neither (counting would require a full keyspace scan — unknown beats expensive).
- `stats()` itself never throws, even against a dead backend.
- `resetStats()` zeroes the four counters; entries are untouched.

---

## 9. Invalidation: forgetting on purpose

TTL bounds staleness, but when underlying data changes you want fresh answers *now*. Because the key format embeds the model (`axis:<Model>:<digest>`), the manager tracks which keys belong to which model and can forget exactly one dataset:

```typescript
// After an INSERT / UPDATE / DELETE affecting requisitions:
const removed = await axis.invalidateModel("PurchaseRequisitions");
console.log(`dropped ${removed} cached quer${removed === 1 ? "y" : "ies"}`);
```

| Operation | Scope | Use when |
|-----------|-------|----------|
| `invalidateModel(model)` | Every cached query for one model; returns the removal count. | A write path touched that model's data. Precise, cheap, safe to call often. |
| `delete(query)` | One exact query. | You know the single entry that changed (rare; usually prefer the model call). |
| `clear()` | Everything, all models. | Schema/model-definition changes, or a big-bang reset. Blunt — expect a thundering herd of misses after. |

The per-model index lives in the manager (a `Map<model, Set<key>>`), so invalidation works uniformly across backends — including remote ones where scanning for keys would be expensive. Stale index entries are harmless: deleting an already-evicted or expired key is a no-op.

---

## 10. Engine integration: where caching hooks in

`AxisQueryEngine` accepts an optional third constructor argument — a `CacheManager`. The pipeline from [Section 1](#1-how-a-query-flows-through-the-cache) in code:

```typescript
// 1. Validate → 2. AST → 3/4. Resolve (errors throw here, uncached)
// 5. Cache lookup (skipped entirely when no manager is wired)
if (this.cache !== undefined) {
  const cached = await this.cache.get<QueryResult<T>>(query);
  if (cached !== undefined) return cached; // HIT
}
// 6. Compile → 7. Execute → 8. Store (per-query cacheTtl wins)
const result = await this.executor.execute<T>(compiled);
if (this.cache !== undefined) {
  await this.cache.set(query, result, query.cacheTtl);
}
return result;
```

Consequences of hooking in *after* resolution:

- **Errors are never cached.** Validation, resolution, compilation, and execution failures all throw before any store. Retries always reach Postgres.
- **Behavior without a manager is identical.** Omit `cache` from `AxisConfig` and the two conditionals vanish — zero overhead, zero behavior change. Caching is opt-in, not a tax.
- **Cache misses can't change error semantics.** Whether the backend is warm, cold, or on fire, the same queries succeed and the same bad queries fail the same way.

---

## 11. ValkeyCache (production backend)

One shared, out-of-process store for every app instance, speaking the Redis protocol via `ioredis` (`^6.0.0`). Drop it in wherever a `Cache` goes — the manager and engine can't tell the difference:

```typescript
import { ValkeyCache } from "axis";

const backend = new ValkeyCache({
  url: "valkey://localhost:6379", // ignored when `client` is given
  client: existingRedis,           // optional: shared/injected client
  clearMatch: "axis:*",            // SCAN pattern for clear()
  scanCount: 100,                  // SCAN page-size hint
});
```

| Concern | How ValkeyCache handles it |
|---------|---------------------------|
| Serialization | Values are JSON-encoded. A corrupt entry is treated as a miss and reaped best-effort. Unserializable values throw `TypeError` instead of writing garbage. |
| TTL precision | Stored via `SET … PX <ms>` — exact milliseconds, no seconds rounding. `ttl: 0` skips the write (Valkey rejects `PX 0`). |
| Safe `clear()` | Iterates `SCAN MATCH <clearMatch> COUNT n` and removes pages with non-blocking `UNLINK`. Never `FLUSHDB` — a shared instance's foreign keys (sessions, queues) are untouched. |
| Ownership | `close()` disconnects (`quit()`) only a client the adapter created. An injected client is never closed — it stays the caller's own. Same rule as the manager. |
| Testability | The constructor accepts a minimal `ValkeyClient` command surface, so tests inject an in-memory fake — no live server needed. `ioredis.Redis` satisfies it structurally. |

### Production checklist

- **Share one Valkey across instances** with a common `clearMatch` (default `axis:*`), or scope per environment (`axis:prod:*`) to avoid cross-env wipes.
- **Size Valkey memory** for `entries × average result` plus headroom; set a Valkey-side `maxmemory-policy` (e.g. `volatile-lru`) as a backstop.
- **Remember fail-open:** if Valkey goes down, queries slow down but keep answering. Alert on the manager's miss rate, not on the outage itself.
- **Call `close()` on shutdown** (`Axis.close()` already closes manager-owned backends) so the process exits cleanly.

---

## 12. Configuration reference

Everything funnels through `CacheConfig` on the `Axis` constructor:

```typescript
new Axis({
  database: { url: process.env.DATABASE_URL },
  registry,
  cache: {
    enabled: true,   // master switch (default true once `cache` is given)
    ttl: 60_000,      // default TTL in ms (default 60_000)
    backend: new ValkeyCache({ url: process.env.VALKEY_URL }), // default MemoryCache
    manager: customManager, // optional: take full control, skips backend/ttl construction
  },
});
```

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `enabled` | `boolean` | `true` | Master switch. `false` disables all caching without removing the wiring. |
| `ttl` | `number` (ms) | `60_000` | Default entry lifetime. Overridable per query via `cacheTtl`; per `set()` call via its `ttl` argument. |
| `backend` | `Cache` | `new MemoryCache()` | Storage. Ignored when `manager` is given. |
| `manager` | `CacheManager` | — | Fully-built manager (custom prefix, backend, TTL). Used as-is. |

### Recipes

**Local development** — in-process cache, short TTL, no infrastructure:

```typescript
new Axis({
  database: { url: process.env.DATABASE_URL },
  registry,
  cache: { enabled: true, ttl: 30_000 },
});
```

**Production** — shared Valkey, per-environment namespace:

```typescript
import { Axis, CacheManager, ValkeyCache } from "axis";

const cacheManager = new CacheManager({
  backend: new ValkeyCache({ url: process.env.VALKEY_URL }),
  ttl: 60_000,
  keyPrefix: `axis:${process.env.NODE_ENV ?? "dev"}`,
});

const axis = new Axis({ database: { url: process.env.DATABASE_URL }, registry, cache: { manager: cacheManager } });

// Observability + freshness hooks:
console.log(await axis.cache?.stats());
await axis.invalidateModel("PurchaseRequisitions"); // after a write
```

**Per-query freshness** — one hot dashboard stays live, everything else relaxed:

```json
{
  "model": "PurchaseRequisitions",
  "metrics": ["pendingCount"],
  "cacheTtl": 5_000
}
```

---

## 13. Wiring it into the middleware

The middleware builds its client in `src/app.ts` (`createApp`) — today without caching:

```typescript
const axis = new Axis({ database: { url: databaseUrl }, registry });
```

Enabling cache is a two-line change plus environment. First extend `src/config.ts` with the existing helpers:

```typescript
export const config = {
  port: optionalInt("PORT", 3000),
  databaseUrl: required("DATABASE_URL", "postgres://localhost:5432/postgres"),
  defaultLimit: optionalInt("AXIS_DEFAULT_LIMIT", 100),
  cacheEnabled: process.env.CACHE_ENABLED !== "false", // default on
  cacheTtlMs: optionalInt("CACHE_TTL_MS", 60_000),
  valkeyUrl: process.env.VALKEY_URL ?? "",             // empty → MemoryCache
} as const;
```

Then pass a `cache` block where the client is constructed:

```typescript
import { Axis, ModelRegistry, ValkeyCache, MemoryCache } from "axis";

const axis = new Axis({
  database: { url: databaseUrl },
  registry,
  cache: {
    enabled: config.cacheEnabled,
    ttl: config.cacheTtlMs,
    backend: config.valkeyUrl
      ? new ValkeyCache({ url: config.valkeyUrl })
      : new MemoryCache(),
  },
});
```

With that in place, `POST /query` responses are cached transparently — no endpoint changes. Two optional follow-ups complete the story:

- **Observability:** expose `GET /cache/stats` returning `await axis.cache?.stats()` so dashboards can chart hit ratio.
- **Freshness:** after any write path, call `await axis.invalidateModel("<Model>")`; for schema-level resets, `await axis.cache?.clear()`.

> **Env summary:** `CACHE_ENABLED` (`"false"` disables; default on), `CACHE_TTL_MS` (default `60000`), `VALKEY_URL` (unset → in-process `MemoryCache`). Keep all TTLs in milliseconds, everywhere.

---

## 14. FAQ

### Will caching ever return a wrong answer?

No — by construction. Keys are deterministic over the full normalized query (different questions → different keys), only successful results are stored, and TTL plus invalidation bound staleness. A bug in the cache layer can only cause extra misses (slower), never wrong hits.

### What happens when Valkey is down?

Queries keep working. Reads degrade to misses, writes are skipped, invalidation counts zero — all silently. Watch the manager's miss rate to notice; the outage itself needs no emergency handling in the query path.

### Why isn't the cache consulted before validation?

Because invalid queries must fail identically with caching on or off, and their failures must never populate the cache. Resolving first also guarantees the model segment of the key refers to a real model.

### Two app instances + MemoryCache — problem?

Not a correctness problem (each instance just builds its own cache), but a hit-rate problem: identical queries miss once per instance. Share a `ValkeyCache` when you scale horizontally.

### Why do identical queries with different TTLs share an entry?

TTL describes freshness policy, not content. The first write wins the entry's lifetime; a later `set` for the same key refreshes value and expiry together. If you need isolation by freshness, use different key prefixes (separate managers).

### Does `clear()` affect other apps on shared Valkey?

No. It SCANs only `clearMatch` (default `axis:*`) and unlinks those keys. Foreign keyspaces are never touched — there is deliberately no `FLUSHDB` anywhere in the codebase.

### Where are the tests?

`tests/cache/` in the `axis` package: key generation (`cache-key-generator.test.ts`), manager behavior (`cache-manager.test.ts`), local backend (`memory-cache.test.ts`), engine integration with a fake database (`query-engine-cache.test.ts`), and the Valkey adapter against an in-memory client fake (`valkey-cache.test.ts`) — no live Valkey needed to verify behavior.

---

Companion to Axis Documentation — same theme, same structure. Covers the implementation in `src/core/cache/`, the engine hook, and Valkey operations.
