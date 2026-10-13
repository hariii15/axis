# Caching workflow

How a `POST /query` turns into a cache HIT or MISS in this middleware, and what each layer does under the hood. Library code lives in the `axis` package (`node_modules/axis/dist/...`); wiring lives in `src/`.

## 1. The full path of one query

```
Client
  │
  ▼
POST /query  (src/app.ts — express.json, 256kb limit)
  │
  ▼
axis.query(input)  (axis package: Axis → AxisQueryEngine.query)
  │
  ├─ 1. Validate (parseAxisQuery — bad shape → ValidationError, HTTP 400)
  ├─ 2. AST build (JSON → internal AST)
  ├─ 3. Resolve (registry + resolver — unknown model/axis/metric → 422)
  ├─ 4. Cache lookup (CacheManager.get — HIT returns here, no SQL)
  ├─ 5. Compile (resolved query → SQL string)
  ├─ 6. Execute (pg pool → Postgres)
  └─ 7. Store (CacheManager.set — then return result)
```

The ordering is the whole design: the cache sits **after** validation and resolution, so invalid queries fail identically with caching on or off, and failures are never stored. Only a query that survived steps 1–3 can read or write the cache.

## 2. Startup wiring

`src/server.ts` calls `createApp(databaseUrl, { cacheEnabled, cacheTtlMs, valkeyUrl })` with values from `src/config.ts`. `createApp` (`src/app.ts`) then does, in order:

1. Build and fill a `ModelRegistry` (currently just `PurchaseRequisitions`).
2. Pick a backend. Precedence: injected `cacheManager` > injected `cacheBackend` > `valkeyUrl ? new ValkeyCache(url) : new MemoryCache()`. With no env set, that is `new MemoryCache()` — one `Map` in this process, no network, no connection to open.
3. Construct `new Axis({ database, registry, cache: { enabled, ttl, backend } })`. The `Axis` constructor wraps those three options in a `CacheManager` and hands it to the query engine. `axis.cache` is that manager; the engine never sees the backend directly.
4. Record `cacheBackendKind` (`"memory" | "valkey" | "custom" | "disabled"`) for the startup log and tests.

Relevant env (`src/config.ts`):

| Var | Default | Effect |
| --- | --- | --- |
| `CACHE_ENABLED` | on (only `"false"` disables) | `false` → manager with `enabled: false`: every `get` misses, `set`/`delete`/`clear` are no-ops, backend never touched |
| `CACHE_TTL_MS` | `60000` | Manager default TTL, milliseconds |
| `VALKEY_URL` | `""` (unset → memory) | Non-empty → build `ValkeyCache` instead of `MemoryCache`. This is the entire Valkey migration: set the var, restart, no code change |

## 3. Key building: same question → same key

`CacheManager.keyFor` delegates to `buildCacheKey(query, { prefix })`. Output shape:

```
axis:PurchaseRequisitions:9f2c…a41b
 │     │                       └── sha256 hex (64 chars) of the normalized query
 │     └── model segment, sanitized ([^A-Za-z0-9_.-] → "_"), kept readable for SCAN/debug
 └── key prefix (manager's keyPrefix, default "axis")
```

Two models that sanitize identically (`a/b` vs `a_b`) still hash differently, because the raw model name is inside the hashed payload too — the plaintext segment is only a label.

Before hashing, the query is normalized (`normalizeQuery`):

- `axes` / `metrics`: de-duplicated and sorted. `["b","a","a"]` ≡ `["a","b"]`.
- `filters`: each reduced to `{ field, operator, value }`, then the whole list sorted by its canonical string form (sorting by field alone would leave same-field filters in input order; AND is commutative so input order must not leak). Scalar `in`/`notIn` value lists are sorted the same way.
- `orderBy`: mapped to `{ field, direction }` but **not** sorted — sort priority is significant.
- Empty arrays are dropped (`axes: []` ≡ omitted). `limit` / `offset` pass through untouched. `cacheTtl` is excluded — freshness policy is not identity.
- Comparison is code-unit order (`a < b`), never `localeCompare`, so the same query hashes identically on hosts with different ICU/locale data.

Serialization (`stableStringify`) sorts object keys and gives every distinct value a distinct token. The reason it exists instead of `JSON.stringify`: `JSON.stringify(NaN)` and `JSON.stringify(Infinity)` both produce `"null"`, which would collide with a real `null`. Here they serialize as `NaN`, `Infinity`, `-Infinity`. `undefined` → `"undefined"`, `bigint` → `"bigint:<digits>"`. Functions and symbols throw `TypeError` — a loud error beats a silent key collision.

What changes the key vs what doesn't:

| Difference | Same key? | Reason |
| --- | --- | --- |
| Axes/metrics order, duplicates | Yes | Selection order is insignificant |
| Filter order, `in`-list order | Yes | AND is commutative |
| `axes: []` vs omitted | Yes | Empty ≡ absent |
| Different `cacheTtl` | Yes | TTL is freshness, not content |
| Different `orderBy` order/direction | No | Sort priority changes the answer |
| Different `limit`/`offset` | No | Different page, different answer |

Cost note: key building hashes the normalized query on **every** request, hit or miss. It is pure CPU (no I/O) and small relative to SQL + network, but it is not free.

## 4. Lookup and store (CacheManager)

The manager owns four counters (`hits`, `misses`, `sets`, `deletes`), a per-model key index (`Map<model, Set<key>>`), and the backend reference. It never throws into the query path — every backend failure degrades to miss/skip (Section 7).

`get(query)`:

1. If `enabled === false`, return `undefined` immediately (backend untouched, counters untouched).
2. Build the key. Unbuildable key (post-validation, should be impossible) → count a miss, return `undefined`.
3. `await backend.get(key)`. `undefined` (absent, expired, or corrupt) → miss. Anything else → hit, and the value is deep-copied before returning.

`set(query, value, ttl?)`:

1. Same disabled/key-failure guards (silently skip).
2. Deep-copy the value, then `backend.set(key, copy, ttl ?? defaultTtl)`. The engine passes the query's own `cacheTtl` as `ttl` when present, so per-query TTL wins; otherwise the manager default applies.
3. On success, increment `sets` and record the key in the per-model index for later `invalidateModel`. Note: `sets` counts only **successful** writes — a throwing backend increments nothing.

Copy semantics matter because the backend is in-process: without copies, the caller could mutate the object it passed to `set` (or the object a HIT returned) and silently corrupt the stored entry for all later readers. So the manager `structuredClone`s on both paths — caller owns their object, cache owns its entry. `structuredClone` failure falls back to returning the reference rather than crashing the query (cached results are plain rows, so the fallback never triggers in practice).

`delete(query)` removes one exact query's key and un-tracks it (`deletes` +1). `clear()` forgets the whole key index and empties the backend. `invalidateModel(model)` deletes exactly the tracked keys for one model and returns how many were removed (`deletes` += removed). Stale index entries are harmless — deleting an already-evicted or expired key is a no-op.

`stats()` returns `{ hits, misses, sets, deletes }` plus `entries`/`evictions` merged from `backend.describe()` when the backend reports them (`MemoryCache` does; `ValkeyCache` reports neither — counting would need a keyspace scan). `stats()` never throws. `resetStats()` zeroes the four counters and touches nothing else.

`close()` closes the backend only if the manager created it (`new MemoryCache()` default). An injected backend — or the middleware's `MemoryCache`, which the manager did not create — is left alone; `Axis.close()` calls through, and shutdown in `src/server.ts` relies on that.

## 5. MemoryCache internals

A `Map<string, { value, expiresAt? }>` with a size cap (`maxSize`, default 1000, must be ≥ 1).

- `set(key, value, ttl)`: validates the TTL (non-number, `NaN`, `±Infinity`, or negative → `RangeError`, nothing stored), converts it to an absolute `expiresAt = Date.now() + ttl`, then delete-then-set. The delete-first matters: re-setting an existing key moves it to the newest insertion position so a hot key is not evicted as "oldest". Omitted TTL means no `expiresAt` — the entry lives until evicted or invalidated.
- `get(key)`: missing → `undefined`. Present but `Date.now() >= expiresAt` → delete and return `undefined` (lazy expiry; `ttl: 0` therefore expires on next read). Otherwise return the stored reference (the manager already handles copying).
- `size` counts held entries including not-yet-reaped expired ones. `describe()` returns `{ size, evictions }`.
- Eviction runs only inside `set`, only when over cap, and stops as soon as the cap is met. Two passes: first sweep expired entries (garbage — **not** counted), then evict oldest-inserted first (`Map` iterates in insertion order; each **counted** in `evictionCount`). Work is proportional to the overflow, not the map.
- `delete` on a missing key is a no-op. No connections, no `close()` needed.

Consequence of in-process storage: each Node process has its own cache. Two middleware instances never share entries — correctness is unaffected (each just misses once), but hit rate per instance is lower. That is the reason to switch to Valkey when scaling horizontally.

## 6. TTL precedence

Three levels, highest first:

1. Per-query `cacheTtl` on the query body (`{ model, metrics, cacheTtl: 5000 }`) — validated like any other field, carried by the engine into `manager.set`. First write wins the entry's lifetime; a later `set` for the same key refreshes value and expiry together.
2. Manager default (`CACHE_TTL_MS`, 60s) — applies to every `set` that does not pass an explicit TTL.
3. No expiry — only when TTL is omitted at every level. There is no "no TTL" knob on the default path (the default is always a number), so entries always expire unless a custom manager/backend path omits it.

Invalid TTLs (`NaN`, `Infinity`, negative) throw `RangeError` at the layer that receives them instead of storing instantly-dead entries.

## 7. Fail-open contract

Caching is a pure performance layer: it can only cost a miss when broken, never change an answer or an error. Concretely:

- Backend throws on `get` → counted as miss, query falls through to Postgres.
- Backend throws on `set` → skipped silently, result still returned.
- Backend throws on `delete`/`clear`/`invalidateModel` → skipped (invalidate keeps going through remaining keys, returns how many actually deleted).
- Corrupt entry (Valkey: unparseable JSON) → treated as miss and reaped best-effort.
- `stats()` swallows backend errors and returns at least the four manager counters.

Operational upshot: if Valkey goes down, the symptom is a climbing miss rate and slower responses — not errors. Alert on `misses / (hits + misses)`, not on the cache itself.

## 8. Reading `GET /cache/stats`

```json
{
  "data": {
    "enabled": true,
    "backend": "memory",
    "stats": { "hits": 120, "misses": 35, "sets": 35, "deletes": 7, "entries": 28, "evictions": 7 },
    "hitRatio": 0.774
  }
}
```

- `hits` — served from cache, no SQL. `misses` — fell through to Postgres (includes cold starts, expiries, invalidations, backend failures). Healthy steady state: `misses` ≈ `sets` (each miss stores), `hitRatio = hits / (hits + misses)`.
- `sets` far above `misses` → entries written but never re-read (TTL too long, keys too unique, or traffic is one-offs — cache is pure overhead).
- `evictions` climbing → `maxSize` too small for the working set; entries die by capacity instead of TTL.
- `entries` — currently held (MemoryCache only; Valkey reports unknown by design).
- `hitRatio: null` — no traffic yet. When `enabled: false`, the endpoint returns `{ enabled: false, stats: null }`.
- `resetStats` zeroes counters for clean before/after measurements without dropping entries.

## 9. Invalidation: which endpoint, when

| Endpoint | Manager call | Scope | Use when |
| --- | --- | --- | --- |
| `DELETE /cache/:model` | `invalidateModel(model)` | All cached queries for one model; returns `removed` count | Any write path changed that model's data. Precise, cheap, safe to call often |
| `DELETE /cache` | `clear()` | Everything, all models | Schema or model-definition change. Blunt — expect a burst of misses after |
| `POST /cache/reset-stats` | `resetStats()` | Counters only | Before a measurement window |
| `GET /cache/key?...` | `keyFor(query)` | Nothing (read-only debug) | Checking which key a query maps to |

There is no per-query DELETE endpoint; single-entry removal exists on the manager (`delete(query)`) but is rarely what a write path wants — one row change usually affects many cached queries over the same model, so `invalidateModel` is the default. The per-model index lives in the manager process, so invalidation works the same on MemoryCache and Valkey (no key scan needed). With MemoryCache the index is per-process: in a multi-instance setup each instance must receive the invalidation call.

## 10. Endpoint reference

- `POST /query` and `POST /query/:model` — the only cached read path. Request body is the `AxisQuery`; `:model` fills `model` from the path. Success envelope `{ data: { rows, rowCount }, meta: { model, limit?, offset? } }` is what gets cached (rows + rowCount). Errors map by `err.name`: `ValidationError` → 400, `ResolutionError`/`CompilationError` → 422, `ExecutionError`/`DatabaseError` → 502.
- `GET /cache/stats`, `GET /cache/key`, `POST /cache/reset-stats`, `DELETE /cache`, `DELETE /cache/:model` — Section 9. Note route order: `/cache` (exact) and `/cache/:model` coexist; `/cache/key?...` only rebuilds `{ model, axes, metrics }` from the querystring, so it shows the key for simple queries, not filtered/sorted ones.
- `GET /health`, `GET /models`, 404 envelope, central error handler — unchanged by caching.

## 11. Switching to Valkey later

Set `VALKEY_URL=valkey://<host>:6379` and restart. `createApp` builds `ValkeyCache` instead; manager, engine, and endpoints are untouched. Behavioral differences to know:

- Values are JSON-serialized (MemoryCache stores references + manager-level copies). Unserializable values throw `TypeError` instead of writing garbage.
- TTL is stored via `SET … PX <ms>` — exact milliseconds. `ttl: 0` skips the write (Valkey rejects `PX 0`).
- `clear()` SCANs only the `clearMatch` namespace (default `axis:*`) and UNLINKs in pages — never `FLUSHDB`, so foreign keyspaces on a shared instance survive.
- `describe()` returns `{}` — `entries`/`evictions` disappear from stats; `hits`/`misses`/`sets`/`deletes` keep working (they are manager-owned).
- `close()` quits only a client the adapter created; an injected client is never closed.
- Scope `clearMatch` per environment (`axis:prod:*`) if one Valkey serves several.

## 12. Limits worth remembering

- MemoryCache is per-process: no sharing across instances, no persistence across restarts.
- `clear()` (any backend) causes a thundering herd — every query misses at once. Prefer `invalidateModel`.
- Identical queries with different TTLs share one entry; the first write's lifetime wins until refreshed.
- Key building runs per request even on HITs; filter-heavy queries pay more hashing, still dwarfed by SQL.
- `GET /cache/key` covers only model/axes/metrics — sufficient for key-shape debugging, not a full query inspector.
