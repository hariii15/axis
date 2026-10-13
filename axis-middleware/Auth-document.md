# Axis Phase 8 — Authentication, Security Context, Multi-Tenancy and PostgreSQL RLS

## 1. Purpose

Phase 8 makes Axis completely application-agnostic for security:

- Axis does NOT know JWT structure, claim names, tenant IDs, user IDs, column names, Express, or auth libraries.
- The middleware/application owns authentication and converts identity into a generic `AxisContext`.
- Axis receives that context plus application-registered security mappings and establishes PostgreSQL session state before running SQL.
- PostgreSQL Row-Level Security (RLS) enforces the actual row filtering.
- Caching is security-aware so one tenant/user can never read another tenant/user's cached result.

## 2. End-to-End Pipeline

```text
HTTP Request
  -> Express middleware: Authorization: Bearer <JWT>
  -> verifyJwt(token, secret): signature + expiry + sub/tenantId check
  -> createAxisContext(decodedJwt): JWT claims -> generic AxisContext
  -> req.axisContext
  -> axis.query(queryJson, { context })
  -> validate -> AST -> resolve model -> resolveSecurityContext (fail-closed)
  -> cache lookup with security-aware key (HIT returns, MISS continues)
  -> compile resolved query -> SQL
  -> executor inside Database.transaction:
       BEGIN
       SELECT set_config(sessionKey, value, true)  -- once per mapping, parameterized
       execute compiled SQL on same client
       COMMIT (or ROLLBACK on error, client always released)
  -> PostgreSQL RLS uses current_setting('app.tenant_id', true) etc.
  -> rows returned -> cache store under security-aware key -> QueryResult
```

### Architecture diagram

```text
                    HTTP Request
                         |
                    Express Middleware
                    Authorization header
                         |
                      Verify JWT
                         |
                      Decode JWT
                         |
                    AxisContext { tenant, user, roles }
                         |
                    AxisQueryEngine.query + context
                         |
                    Security Resolver (context x mappings)
                         |
                    PostgreSQL Transaction
                    BEGIN / SET LOCAL / query / COMMIT
                         |
                    PostgreSQL RLS (tenant_id / created_by = context)
                         |
                    Compiled SQL (SELECT ...)
                         |
                    Database Result
```

## 3. Design Rules (enforced)

1. JWT lives in middleware only.
2. JWT verification lives in middleware only.
3. JWT claim names live in middleware only.
4. Axis only sees generic `AxisContext`.
5. Axis never hard-codes tenant IDs, user IDs, or column names.
6. Security mappings are registered by the application.
7. PostgreSQL RLS enforces row security; Axis only sets session context.
8. Security context is transaction-scoped (`SET LOCAL` semantics via `set_config(..., true)`).
9. Missing required context fails closed — query never executes.
10. Cache keys include the configured security subset.
11. Connection pooling never leaks context between requests.
12. Axis stays framework-independent (no Express import).
13. Existing `JSON -> Validator -> AST -> Resolver -> SQL` pipeline is unchanged.
14. Non-security queries keep working when no security config is registered.

## 4. What Was Implemented

### 4.1 Generic AxisContext

`src/core/context/types.ts`:

```ts
export type AxisContext = Record<string, unknown>;
```

Example application context:

```ts
const context: AxisContext = {
  tenant: "tenant-001",
  user: "hariharpradeep@gmail.com",
  roles: ["MANAGER"],
};
```

The old hardcoded `RequestContext { userId, role, tenantId }` remains for backward compatibility but is no longer on the query path.

### 4.2 Security Configuration Types

`src/core/security/types.ts`:

```ts
export interface SecurityMapping {
  contextKey: string;  // key in AxisContext, e.g. "tenant"
  column: string;      // app DB column, e.g. "tenant_id" (docs/RLS reference)
  sessionKey: string;  // PG session key, e.g. "app.tenant_id"
  required?: boolean;
}

export interface AxisSecurityConfig {
  mappings: Record<string, SecurityMapping>;
}

export interface ResolvedSecurityContext {
  values: Record<string, string>;      // sessionKey -> string value
  cacheKey: Record<string, unknown>;   // contextKey -> raw value (for cache)
}
```

Registration (no Axis source changes needed):

```ts
const axis = new AxisQueryEngine(database, {
  security: {
    mappings: {
      tenant: { contextKey: "tenant", column: "tenant_id", sessionKey: "app.tenant_id", required: true },
      user:   { contextKey: "user",   column: "created_by", sessionKey: "app.user_id",   required: true },
    },
  },
});
```

The `Axis` facade also accepts `security`:

```ts
const axis = new Axis({ database: { url }, security: { mappings: { ... } } });
```

### 4.3 Security Resolver (fail-closed)

`src/core/security/resolver.ts` — `resolveSecurityContext(context, config)`:

1. Iterates every configured mapping.
2. Reads `context[mapping.contextKey]`.
3. Treats `undefined`, `null`, `""` as missing.
4. Throws `SecurityContextError` if `required: true` and missing — query aborts before cache/DB.
5. Coerces `string | number | boolean | bigint` to session string; rejects objects/arrays.
6. Validates `sessionKey` against `/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/` (keys are identifiers, cannot be bound as parameters).
7. Returns `{ values, cacheKey }`. Unknown context keys (e.g. `roles`, `department`) are ignored. Optional mappings (`required: false`) are skipped when absent.

`src/core/security/errors.ts`:

```ts
export class SecurityContextError extends Error {
  readonly contextKey?: string;
}
```

Example error:

```text
SecurityContextError: Required security context value "tenant" is missing.
```

### 4.4 Database Transaction Helper

`src/core/database/database.ts` — `Database.transaction(callback)`:

1. `pool.connect()` (pool error wrapped as `DatabaseError`).
2. `BEGIN` (error wrapped as `DatabaseError`).
3. `await callback(client)`.
4. `COMMIT` on success (error wrapped).
5. `ROLLBACK` on callback error, then rethrow the ORIGINAL error unwrapped (so `SecurityContextError` / `ValidationError` are never masked).
6. `client.release()` in `finally`, always.

This guarantees `SET LOCAL` state dies with the transaction and pooled connections never leak tenant context.

### 4.5 PostgreSQL SET LOCAL (safe)

`src/core/executor/executor.ts` — `PostgreSQLExecutor.execute(compiled, security?)`:

- No security (or empty values): legacy direct `database.query(sql, params)` — zero behavior change.
- With security: runs inside `database.transaction`, issuing once per entry:

```sql
SELECT set_config($1, $2, true);
-- params: [sessionKey, sessionValue]
```

`set_config(key, value, true)` with `is_local=true` is equivalent to `SET LOCAL`. Keys are allow-list validated; values are bound parameters, so `t1'; DROP TABLE ...; --` cannot inject. The compiled SQL then runs on the same client so RLS sees the settings.

### 4.6 Query Engine Integration

`src/core/query-engine/query-engine.ts`:

```ts
export interface AxisQueryEngineOptions {
  registry?: ModelRegistry;
  cache?: CacheManager;
  cacheManager?: CacheManager;
  security?: AxisSecurityConfig;
}

// Backward compatible:
//   new AxisQueryEngine(db, registry, cache)
//   new AxisQueryEngine(db, { registry, cache, security })
async query(input: unknown, options: QueryOptions = {}) // QueryOptions { context?: AxisContext }
```

Pipeline per request:

```text
parseAxisQuery -> buildQueryAST -> registry.get -> resolveQuery
  -> resolveSecurityContext(context ?? {}, security)  [if configured]
  -> cache.get(query, securityCacheKey)
  -> compileQuery -> executor.execute(compiled, resolvedSecurity)
  -> cache.set(query, result, ttl, securityCacheKey)
```

Security context is execution metadata; it never enters the AST unless the app's model SQL references it.

`src/core/query-engine/types.ts` — `QueryOptions { context?: AxisContext }` added to `QueryEngine`.

`src/core/axis.ts` — `AxisConfig.security` added; `Axis.query(input, options)` forwards context.

### 4.7 Security-Aware Cache Keys

`src/core/cache/key-builder.ts` — `CacheKeyOptions.security?: Record<string, unknown>`:

- `undefined` or `{}`: legacy digest over normalized query only (existing tests/keys unchanged).
- Non-empty: digest over `stableStringify({ query: normalized, security: normalizedSecurity })`.
- `normalizeSecurity` drops `undefined` values; `stableStringify` sorts keys, so `{tenant, user}` vs `{user, tenant}` hash identically.
- Only mapping-backed values are passed in (`resolvedSecurity.cacheKey`), never the whole context.

`src/core/cache/cache-manager.ts` — `keyFor(query, security?)`, `get(query, security?)`, `set(query, value, ttl?, security?)`, `delete(query, security?)`. Positional backward compatibility is preserved (`set(query, result, ttl)` still works).

Result:

```text
Query A + tenant-001 -> miss -> DB
Query A + tenant-001 -> HIT
Query A + tenant-002 -> miss -> DB (different key, no leak)
```

### 4.8 Middleware: JWT Verification + AxisContext

All of this lives in the `axis-middleware` package (`src/auth/`) — never in the `axis` library:

```ts
// src/auth/auth.ts
verifyJwt(token, secret): DecodedJwt
createAxisContext(decoded): AxisContext
extractBearerToken(header): string
createAuthMiddleware(secret): Express middleware (sets req.axisContext)
requireAxisContext(req): AxisContext
class AuthError extends Error { statusCode }
```

- `verifyJwt` uses `jsonwebtoken.verify`, requires non-empty token/secret, accepts both claim shapes (`sub`/`userId` + `tenantId`), wraps all failures as `AuthError(401)` (500 only when secret is unconfigured).
- `createAxisContext` maps `{ sub|userId, tenantId, roles|role }` -> `{ user, tenant, roles }`.
- `extractBearerToken` enforces `Bearer <JWT>`, throws on missing header or bad format.
- `createAuthMiddleware(secret)` is real Express middleware (`(req, res, next)`), attaches `req.axisContext`, forwards errors to `next(err)` so the central handler returns 401.

Actual wiring (`src/app.ts`, `src/config.ts`, `src/server.ts`):

```ts
// config.ts: jwtSecret: process.env.AXIS_JWT_SECRET ?? ""
// app.ts (inside createApp, only when jwtSecret is set):
axis = new Axis({ database, registry, cache, security: DEFAULT_SECURITY });
app.use("/query", createAuthMiddleware(jwtSecret));
// POST /query handler:
const result = await axis.query(input, { context: req.axisContext });
// errors: AuthError -> 401, SecurityContextError -> 403
```

## 5. Request-Level Workflow (step by step)

Assume JWT payload `{ "sub": "hariharpradeep@gmail.com", "tenantId": "tenant-001", "roles": ["MANAGER"] }` and query `{ model: "PurchaseRequisitions", metrics: ["newCount"], axes: ["department_name"], filters: [{ field: "status", operator: "equals", value: 1 }] }`.

| # | Layer | Action | Detail |
|---|-------|--------|--------|
| 1 | Client | Sends request | `POST /query`, `Authorization: Bearer <JWT>`, JSON body = Axis query |
| 2 | Middleware | Extract token | `extractBearerToken("Bearer <JWT>")` -> `<JWT>`; 401 if missing/malformed |
| 3 | Middleware | Verify | `jsonwebtoken.verify(token, secret)`; checks signature + `exp`; 401 on invalid/expired/wrong-secret |
| 4 | Middleware | Decode + map | `createAxisContext({ sub, tenantId, roles })` -> `{ user, tenant, roles }` |
| 5 | Middleware | Attach | `req.axisContext = { user: "hariharpradeep@gmail.com", tenant: "tenant-001", roles: ["MANAGER"] }`; `next()` |
| 6 | Route | Call Axis | `axis.query(body, { context: req.axisContext })` |
| 7 | Engine | Validate/AST/resolve | `parseAxisQuery -> buildQueryAST -> resolveQuery`; errors surface exactly as uncached path |
| 8 | Engine | Resolve security | `resolveSecurityContext(context, config)` -> `{ "app.tenant_id": "tenant-001", "app.user_id": "hariharpradeep@gmail.com" }` + `cacheKey { tenant, user }`; throws `SecurityContextError` if required value missing — no cache/DB touch |
| 9 | Cache | Lookup | `buildCacheKey(query, { security: cacheKey })`; HIT returns immediately; MISS continues |
| 10 | Compiler | SQL | `compileQuery(resolved)` -> `SELECT ... FROM upeg.requisition_deails WHERE ... GROUP BY ...` with `?` placeholders |
| 11 | Executor | Transaction | `BEGIN` on one pooled client |
| 12 | Executor | SET LOCAL | `SELECT set_config($1,$2,true)` with `["app.tenant_id","tenant-001"]`, then `["app.user_id","hariharpradeep@gmail.com"]` |
| 13 | PostgreSQL | RLS | Policy evaluates `tenant_id = current_setting('app.tenant_id', true)` (and optionally `created_by = current_setting('app.user_id', true)`) per row |
| 14 | Executor | Main query | Formatted `$1,$2...` SQL + params run on same client; `COMMIT`; client released |
| 15 | Cache | Store | `cache.set(query, result, ttl, cacheKey)` under tenant-bound key |
| 16 | Route | Respond | `{ rows, rowCount }` JSON; tenant-002 repeating the same query gets a different key and its own rows |

Failure branches: invalid JWT -> 401 before Axis; missing required context -> `SecurityContextError`, no `BEGIN`, no cache write; DB error -> `ROLLBACK` + `ExecutionError`/`DatabaseError`, nothing cached; cache backend down -> fail-open miss, query still succeeds.

## 6. PostgreSQL RLS Setup (application-owned)

Axis does not create policies. Example for `upeg.requisition_deails(requisition_id, department_name, status, created_by, amount, created_date, tenant_id)`:

```sql
ALTER TABLE upeg.requisition_deails ENABLE ROW LEVEL SECURITY;

CREATE POLICY requisition_tenant_isolation
ON upeg.requisition_deails
USING (
  tenant_id = current_setting('app.tenant_id', true)
);

-- With user-level isolation:
-- CREATE POLICY requisition_user_isolation
-- ON upeg.requisition_deails
-- USING (
--   tenant_id = current_setting('app.tenant_id', true)
--   AND created_by = current_setting('app.user_id', true)
-- );
```

The same compiled SQL returns different rows per `SET LOCAL` context. Never use persistent `SET` for request scope — always `SET LOCAL` (or `set_config(..., true)`) inside the transaction.

## 7. Tests

| File | Covers |
|------|--------|
| `tests/security/resolver.test.ts` | Valid mapping, missing tenant/user fail-closed, optional mapping, unknown keys ignored, empty-string rejected, unsafe sessionKey rejected |
| `axis/tests/security/*` (resolver, cache-isolation, query-engine-security, rls-integration) | Library-side: mappings, fail-closed, tenant-bound cache keys, transactional `set_config`, pool isolation |
| `axis-middleware/tests/auth.test.ts` | Middleware-side: valid/spec + legacy JWT shapes, invalid signature, expired JWT, missing header, bad Bearer format, AxisContext mapping, middleware attach + error forwarding |
| `axis-middleware/tests/legacy-context.test.ts` | Legacy global JWT context helpers (moved out of the library, kept for compatibility) |
| `tests/security/cache-isolation.test.ts` | Different tenants -> different keys; same tenant reuses; key-order insensitive; legacy key shape; `CacheManager` tenant isolation end-to-end |
| `tests/security/query-engine-security.test.ts` | Parameterized `set_config` in transaction (`BEGIN`/`COMMIT`), fail-closed with zero DB calls, sequential tenant-001/tenant-002 pool isolation with session reset, same-tenant HIT vs cross-tenant MISS counting, quote-injection safety (`DROP TABLE` never in SQL text) |
| `tests/security/rls-integration.test.ts` | Live-PostgreSQL RLS smoke test (runs only when `DATABASE_URL` is set; documents the required policy) |

Verification performed:

- `axis`: `tsc` clean, `dist/` rebuilt with no middleware leftovers; full `vitest run`: 28 files, 272 tests, all passing.
- `axis-middleware`: `tsc` clean; full `vitest run`: 6 files, 258 tests, all passing (4 pre-existing + `auth.test.ts` + `legacy-context.test.ts`).
- Live check against real Express + PostgreSQL: no token -> 401 `AuthError`; valid JWT (both `{sub,...}` and legacy `{userId,...}` shapes) -> 200 with RLS-scoped rows.

## 8. Files Created / Modified

Library (`axis`) — generic, app-agnostic, no middleware:

- `src/core/context/types.ts` (generic `AxisContext`)
- `src/core/security/types.ts`, `errors.ts`, `resolver.ts` (mappings + fail-closed resolver)
- `src/core/database/database.ts` (transaction helper)
- `src/core/executor/executor.ts`, `types.ts` (security-aware execution)
- `src/core/query-engine/query-engine.ts`, `types.ts` (options + context)
- `src/core/axis.ts` (security config + context passthrough)
- `src/core/cache/key-builder.ts`, `cache-manager.ts` (security-aware keys)
- `src/index.ts` (public exports — no auth exports)
- `tests/security/*` (resolver, cache-isolation, query-engine-security, rls-integration)
- Removed from the library: `src/middleware/auth.ts`, `src/core/context/{jwt,resolver,context,type}.ts`, `tests/context/*`, `tests/middleware/*`, `jsonwebtoken` dependency, stale `dist/middleware/*`

Middleware (`axis-middleware`) — owns all auth, env, and HTTP wiring:

- `src/auth/auth.ts` (verifyJwt, createAxisContext, Express middleware)
- `src/auth/context-types.ts`, `context-store.ts`, `jwt.ts`, `context-resolver.ts` (legacy helpers, moved)
- `src/app.ts` (DEFAULT_SECURITY, auth on `/query`, context per request, 401/403 mapping)
- `src/config.ts` (`AXIS_JWT_SECRET`), `src/server.ts` (wiring + logs)
- `tests/auth.test.ts`, `tests/legacy-context.test.ts`
- `package.json` (`jsonwebtoken` moved here)

## 9. Expected Final API

```ts
// axis-middleware (owns auth): src/auth/auth.ts + src/app.ts
import { verifyJwt, createAxisContext } from "./auth/auth.js";

const axis = new Axis({
  database: { url: process.env.DATABASE_URL },
  security: {
    mappings: {
      tenant: { contextKey: "tenant", column: "tenant_id", sessionKey: "app.tenant_id", required: true },
      user:   { contextKey: "user",   column: "created_by", sessionKey: "app.user_id",   required: true },
    },
  },
});

const decoded = verifyJwt(token, process.env.AXIS_JWT_SECRET!);
const context = createAxisContext(decoded);

const result = await axis.query(
  {
    model: "PurchaseRequisitions",
    metrics: ["newCount"],
    axes: ["department_name"],
    filters: [{ field: "status", operator: "equals", value: 1 }],
  },
  { context },
);
```

Separation preserved:

```text
AUTHENTICATION -> Middleware -> AxisContext -> Axis
  -> Security mappings -> PostgreSQL session context -> PostgreSQL RLS -> Database
```
