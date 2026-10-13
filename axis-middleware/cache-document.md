# Axis cache — implementation document

How caching is built inside the `axis` library: every file under `src/core/cache/`, the request path through `Axis` and `AxisQueryEngine`, and the exact behavior of each method. All file paths below refer to the `axis` package unless noted.

## 1. Folder map

```
src/core/cache/
  types.ts          Cache + CacheInfo interfaces (the pluggable contract)
  cache-key.ts      createCacheKey — simple non-hashed key (legacy / debug use)
  key-builder.ts    buildCacheKey — normalized + sha256-hashed production key
  memory-cache.ts   MemoryCache — in-process Map backend
  cache-manager.ts  CacheManager — key generation → lookup → store, stats, invalidation
  valkey-cache.ts   ValkeyCache — shared Redis-protocol backend via ioredis
  index.ts          public re-exports
```

Dependency rule: `query-engine/` and `core/axis.ts` know only `CacheManager`. `CacheManager` knows only the `Cache` interface and `buildCacheKey`. Nothing above the manager imports a concrete backend — that is what makes backends interchangeable.

## 2. Request-level workflow

One `axis.query(input)` executes this path (`src/core/query-engine/query-engine.ts`):

```
1. parseAxisQuery(input)        → AxisQuery | throws ValidationError
2. buildQueryAST(query)         → AST
3. registry.get(query.model)    → ModelDefinition | throws "not registered"
4. resolveQuery(ast, model)     → resolved query | throws ResolutionError
5. cache.get(query)             → HIT: return result (steps 6–8 skipped)
6. compileQuery(resolved)       → SQL | throws CompilationError
7. executor.execute(compiled)   → QueryResult | throws ExecutionError/DatabaseError
8. cache.set(query, result, query.cacheTtl) → return result
```

Steps 5 and 8 each run only `if (this.cache !== undefined)` — the engine's third constructor argument. Omitting `cache` from `AxisConfig` leaves both out: zero overhead, zero behavior change. Caching is opt-in.

The cache sits after validation and resolution on purpose. Invalid shapes, unknown models, axes, metrics, and order fields all throw before any cache contact, so failures are never stored and identical failures surface with caching on or off. Compilation and execution failures likewise throw before step 8, so a failed query never poisons the cache and a retry always reaches Postgres.

`Axis` itself (`src/core/axis.ts`) is thin: the constructor builds a `Database`, a `CacheManager` via `createCacheManager(config.cache)`, and an `AxisQueryEngine(database, registry, cacheManager)`. `axis.cache` exposes the manager for stats and invalidation; `axis.invalidateModel(model)` delegates, returning 0 when no manager exists; `axis.close()` closes the database pool, then the manager.

`createCacheManager` returns `undefined` when `config.cache` is omitted, returns `config.manager` as-is when given (full-control path: backend/TTL construction skipped), and otherwise builds `new CacheManager` from whichever of `backend`/`ttl`/`enabled` are present. Properties are spread conditionally because `exactOptionalPropertyTypes` forbids passing explicit `undefined`.

## 3. `types.ts` — the contract

```ts
export interface CacheInfo { size?: number; evictions?: number; }

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  describe?(): CacheInfo | Promise<CacheInfo>;
  close?(): Promise<void>;
}
```

Per-method contract:

- `get` — stored value, or `undefined` on miss (absent, expired, corrupt). Never throws for a plain miss.
- `set` — stores `value` under `key`. `ttl` is milliseconds; omitted means no expiry. Must reject negative or non-finite TTLs with `RangeError` rather than store instantly-dead entries.
- `delete` — removes one key; missing key is a no-op.
- `clear` — removes everything the cache owns; must never touch foreign keyspaces.
- `describe?` — optional introspection. Absence (or `{}`) means "unknown"; callers cope without it.
- `close?` — optional resource release. Absence means nothing to release.

## 4. `cache-key.ts` — `createCacheKey`

```ts
createCacheKey(query: AxisQuery): string  // → `axis:${stableStringify(query)}`
```

Serializes the raw query with no normalization and no hashing — key length grows with the query, and semantically identical queries in different field order still share a key (object keys sorted) but array order is preserved (filter order significant here, unlike `buildCacheKey`). This is the older/simpler key function, kept exported for debugging and tests; the manager and engine use `buildCacheKey`.

Its local `stableStringify`: `undefined` → `"undefined"`; `NaN`/`Infinity`/`-Infinity` get their own tokens instead of colliding with `null` as under `JSON.stringify`; `null` and non-objects go through `JSON.stringify` with a `?? "undefined"` guard so functions/symbols (impossible post-validation) can never crash keygen; arrays map element-wise; objects sort keys with default `.sort()` and recurse.

## 5. `key-builder.ts` — `buildCacheKey`

```ts
buildCacheKey(query: AxisQuery, options?: CacheKeyOptions): string
// → `<prefix>:<sanitized model>:<sha256 hex digest>`
```

`CacheKeyOptions` is `{ prefix?: string; algorithm?: string }`, defaulting to `"axis"` and `"sha256"`.

### 5.1 Input guards

Non-object or `null` query → `TypeError` naming the received kind (`null`, `array`, or `typeof`). Empty or non-string `model` → `TypeError`. Empty resolved prefix → `TypeError`. These throw loudly because a guessed key would risk cross-query collisions.

### 5.2 Normalization (`normalizeQuery`)

Builds a `CanonicalQuery` containing only `{ model, axes?, metrics?, filters?, orderBy?, limit?, offset? }`:

- `axes` / `metrics` pass through `dedupeAndSort`: `undefined` → `[]`, otherwise de-duplicated via `Set` and sorted. Empty results are omitted from the canonical form, so `axes: []` and omitted produce the same key.
- `filters` map to `{ field, operator, value? }` (extra properties stripped; `value` carried only when defined, so `isNull` without value canonicalizes cleanly), with array values sorted by `normalizeValue`. The list is then sorted by each entry's full `stableStringify` form — sorting by field alone would leave same-field filters in input order, and AND is commutative, so the complete canonical string is the sort key. `orderBy` maps to `{ field, direction }` and is deliberately **not** sorted: priority order changes the answer.
- `limit` / `offset` copy through verbatim. `cacheTtl` is never copied — freshness policy is excluded from identity, so identical queries with different TTLs share one entry.

### 5.3 Helpers

- `normalizeValue` — non-arrays pass through; arrays are copied and sorted by `stableStringify` comparison (covers scalar `in`/`notIn` lists regardless of element type).
- `dedupeAndSort` — `Set` dedupe then `compareStrings` sort.
- `compareStrings` — code-unit order (`a < b ? -1 : …`). `localeCompare` is avoided because ICU data and runtime locale vary per host and would make the same query hash differently on different machines.
- `sanitizeSegment` — replaces `[^A-Za-z0-9_.-]` with `_` for Valkey-safe key segments. The raw model stays inside the hashed payload, so `a/b` and `a_b` (same sanitized segment) still digest differently.
- `typeName` — `null` → `"null"`, arrays → `"array"`, else `typeof`, used only for guard error messages.

### 5.4 Serialization and digest

The file's own `stableStringify` sorts object keys with `compareStrings` and tokens every distinct value distinctly: `undefined` → `"undefined"`; numbers special-case `NaN`/`±Infinity` before `JSON.stringify`; `bigint` → `"bigint:<digits>"`; strings/booleans via `JSON.stringify`; `null` → `"null"`; arrays map element-wise; plain objects recurse over sorted keys. Anything else (function, symbol) throws `TypeError` — refusing to guess beats a silent collision.

The digest is `createHash(algorithm).update(stableStringify(canonical), "utf8").digest("hex")` — 64 hex chars, fixed length regardless of query size, so Valkey memory per key is predictable.

### 5.5 Key equivalence summary

Same key: axes/metrics reordered or duplicated; filters reordered; `in`-list reordered; empty vs omitted selections; different `cacheTtl`. Different key: `orderBy` order or direction; `limit`/`offset`; anything else in the canonical query.

## 6. `memory-cache.ts` — `MemoryCache`

In-process `Map<string, { value: unknown; expiresAt?: number }>` with a size cap.

- Constructor takes `{ maxSize?: number }` (default 1000). Non-integer or `< 1` throws `RangeError` immediately.
- `get(key)` — missing entry → `undefined`. Present with `expiresAt` reached (`Date.now() >= expiresAt`) → deleted and `undefined` (lazy expiry; `ttl: 0` therefore expires on next read). Otherwise returns the stored reference; the manager handles copy isolation above this layer.
- `set(key, value, ttl?)` — `toExpiresAt` validates (`undefined` → no expiry; non-number/non-finite → `RangeError`; negative → `RangeError`) and converts to an absolute timestamp. Then delete-then-set: removing first refreshes the key's insertion position, so an overwritten hot key is not evicted as "oldest". `evictOverflow()` runs after every write.
- `delete(key)` — `Map.delete`; missing key is a no-op. `clear()` — `Map.clear`. `size` getter returns `store.size`, including not-yet-reaped expired entries. `describe()` returns `{ size, evictions }`.
- `evictOverflow()` — returns fast when within cap. Otherwise two passes, each stopping as soon as the cap is met: first sweep deletes expired entries (reclaimed garbage, **not** counted); second pass deletes oldest-inserted first (`Map` iterates in insertion order) and increments `evictionCount` per entry. Only `set` writes, so work stays proportional to the overflow, not the map.

## 7. `cache-manager.ts` — `CacheManager`

Owns the full per-query lifecycle plus statistics and invalidation. State: `backend`, `ownsBackend` (true only when the manager constructed the default `MemoryCache`), `defaultTtl`, `enabled`, `keyPrefix`, the per-model key index `Map<string, Set<string>>`, and counters `hits`/`misses`/`sets`/`deletes`.

- Constructor validates `ttl` (non-number, non-finite, or negative → `RangeError`); defaults are backend `new MemoryCache()`, TTL `DEFAULT_CACHE_TTL_MS` (60_000), `enabled: true`, prefix `"axis"`. Getters `isEnabled` and `ttl` expose the switch and default.
- `keyFor(query)` — `buildCacheKey(query, { prefix: this.keyPrefix })`. Same input → same key.
- `get<T>(query)` — disabled → `undefined` immediately (backend and counters untouched). Unbuildable key → miss counted, `undefined`. Backend `undefined` → miss. Backend value → hit counted and returned as a `structuredClone` copy, so mutating a hit cannot poison later readers. Backend throw → miss counted, `undefined`. Every path resolves; none throws.
- `set<T>(query, value, ttl?)` — disabled or unbuildable key → silent return. Otherwise stores `cloneValue(value)` under the built key with `ttl ?? defaultTtl` (the engine passes the query's own `cacheTtl` here, giving per-query TTL precedence). Backend throw → silent return with no counter movement. Only a successful write increments `sets` and records the key via `trackKey(model, key)`.
- `delete(query)` — disabled or unbuildable key → silent return. Backend throw → silent return. Success increments `deletes` and prunes the key via `untrackKey` (empty per-model sets are removed from the index).
- `invalidateModel(model)` — disabled → 0. Unknown or empty model set → 0. Otherwise deletes each tracked key individually, continuing past per-key failures (fail-open), adds the removed count to `deletes`, drops the model's index entry, and returns the count. Stale index entries (evicted/expired keys) delete as no-ops and still count — the count means "keys processed", not "live entries found".
- `clear()` — always forgets the whole key index first, then (when enabled) clears the backend, swallowing failures.
- `stats()` — always returns `{ hits, misses, sets, deletes }`, then (when enabled) merges `entries`/`evictions` from `backend.describe?.()`. Never throws, even against a dead backend.
- `resetStats()` — zeroes the four counters synchronously; entries untouched.
- `close()` — closes the backend only when `ownsBackend`; an injected backend stays the caller's own.
- `trackKey` / `untrackKey` — private index maintenance. `cloneValue` — `structuredClone` with a reference fallback (functions/symbols can never be valid cached results, but a fallback beats crashing the query path).

Counter semantics to rely on: `sets` counts successful writes only; `deletes` counts single deletes plus invalidated keys; `misses` includes absent, expired, corrupt, disabled-path-excluded, key-failure, and backend-failure lookups — i.e. every fall-through to Postgres.

## 8. `valkey-cache.ts` — `ValkeyCache`

Production backend over the Redis protocol, interchangeable behind `Cache`. Key behaviors:

- `ValkeyClient` is a minimal six-command surface (`get`, `set`, `del`, `unlink`, `scan`, `quit`). `ioredis.Redis` satisfies it structurally; tests inject an in-memory fake, so no live server is needed to verify behavior.
- Constructor takes `{ url?, client?, clearMatch?, scanCount? }` (defaults `valkey://localhost:6379`, `"axis:*"`, `100`). Injected `client` sets `ownsClient: false`; otherwise a `Redis` is created with `lazyConnect: true` and `enableAutoPipelining: true` and wrapped by `adaptRedis`. The adapter exists because `ioredis`' overloaded `set` accepts trailing callbacks and is not directly assignable to the minimal surface — the wrapper forwards only the argument shapes used.
- `get` — `null` → `undefined` (miss). Otherwise `JSON.parse`; corrupt JSON → miss with best-effort `del` reap. Throws from the client propagate to the manager, which counts a miss.
- `set` — `assertTtl` rejects non-number/non-finite/negative TTLs with `RangeError`. `ttl === 0` returns without writing (Valkey rejects `PX 0`; zero means already expired). `JSON.stringify` returning `undefined` throws `TypeError` instead of writing garbage. Otherwise `SET key raw` without TTL, or `SET key raw PX Math.floor(ttl)` — exact milliseconds, no seconds rounding.
- `delete` — `del(key)`. `clear()` — paged `SCAN MATCH <clearMatch> COUNT <scanCount>` loop, removing each page with non-blocking `UNLINK`; cursor `"0"` ends. Never `FLUSHDB`, so foreign keyspaces on a shared instance survive. `describe()` returns `{}` — size would need a keyspace scan, and unknown beats expensive. `close()` quits only a self-created client, swallowing failures; injected clients are never closed.

## 9. `index.ts` — public surface

Re-exports types (`Cache`, `CacheInfo`, `MemoryCacheOptions`, `CacheKeyOptions`, `CacheManagerOptions`, `CacheStats`, `CacheStatsSnapshot`, `ValkeyCacheOptions`, `ValkeyClient`) and values (`MemoryCache`, `createCacheKey`, `buildCacheKey`, `CacheManager`, `DEFAULT_CACHE_TTL_MS`, `ValkeyCache`). This is the module boundary consumers import from; internal helpers (`normalizeQuery`, `stableStringify`, `evictOverflow`, `cloneValue`, `adaptRedis`, …) stay private to their files.

## 10. TTL reference (all layers, milliseconds)

| Layer | Rule |
|---|---|
| `AxisQuery.cacheTtl` | Per-query override, carried by the engine into `manager.set`. Excluded from the key. First write wins the entry's lifetime; a later `set` refreshes value and expiry together |
| `CacheManager` default (`ttl`, 60s) | Applies to every `set` without an explicit TTL |
| Omitted everywhere | No expiry (reachable only when no default applies, e.g. direct backend use without TTL) |
| Validation | `CacheManager` constructor, `MemoryCache.toExpiresAt`, and `ValkeyCache.assertTtl` all throw `RangeError` on negative or non-finite TTLs |
| `ttl: 0` | "Already expired": `MemoryCache` expires it on next read; `ValkeyCache` skips the write |

## 11. Failure matrix

| Failure | Where caught | Visible effect |
|---|---|---|
| Invalid query shape | Engine step 1, before cache | `ValidationError`; cache untouched |
| Unknown model/axis/metric, compile error | Engine steps 3–4/6, before store | 422-class error; nothing stored |
| Execution/database error | Engine step 7, before store | Error propagates; retry reaches Postgres |
| Backend throw on `get` | `CacheManager.get` | Miss; query falls through to Postgres |
| Backend throw on `set`/`delete`/`clear` | Respective manager method | Silently skipped; result still returned |
| Corrupt Valkey entry | `ValkeyCache.get` | Miss + best-effort reap |
| Unserializable key input | `buildCacheKey` | `TypeError` → manager treats lookup as miss, store as skip |
| `stats()` backend failure | `CacheManager.stats` | Counters still returned |

Design invariant: a bug or outage in the cache layer can only cause extra misses (slower), never wrong answers or changed errors.
