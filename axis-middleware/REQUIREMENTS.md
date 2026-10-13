# Axis Library — Adoption Requirements

> Derived by deep analysis of both the `axis` library source and the `axis-middleware` reference implementation. Reflects the **current actual deployment state** as of the latest code revision.

---

## Table of Contents

1. [Current Deployment Status](#1-current-deployment-status)
2. [Pre-requisites — Infrastructure](#2-pre-requisites--infrastructure)
3. [Pre-requisites — Runtime & Toolchain](#3-pre-requisites--runtime--toolchain)
4. [Pre-requisites — Project Configuration](#4-pre-requisites--project-configuration)
5. [Pre-requisites — Environment Variables](#5-pre-requisites--environment-variables)
6. [What the Middleware Must Provide](#6-what-the-middleware-must-provide)
   - 6.1 [Install & Import Axis](#61-install--import-axis)
   - 6.2 [Define & Register Models](#62-define--register-models)
   - 6.3 [Instantiate Axis](#63-instantiate-axis)
   - 6.4 [Wire OpenSearch Adapter](#64-wire-opensearch-adapter)
   - 6.5 [Wire Embedding Provider](#65-wire-embedding-provider)
   - 6.6 [Wire Security & JWT Auth](#66-wire-security--jwt-auth)
   - 6.7 [Expose HTTP Routes](#67-expose-http-routes)
   - 6.8 [Handle Errors Correctly](#68-handle-errors-correctly)
   - 6.9 [Graceful Shutdown](#69-graceful-shutdown)
7. [Model Definition Contract](#7-model-definition-contract)
8. [Query DSL Contract](#8-query-dsl-contract)
9. [Security Context Contract](#9-security-context-contract)
10. [Feature Matrix](#10-feature-matrix)
11. [Common Pitfalls](#11-common-pitfalls)

---

## 1. Current Deployment Status

What is **actually active** in this deployment right now, based on the current `.env` and source code.

| Feature | Status | Detail |
|---|---|---|
| **PostgreSQL** | ✅ Active | `po` @ `localhost:5432` — library-level only (cron/internal). No HTTP `/query` route. |
| **JWT Authentication** | ✅ Active | `AXIS_JWT_SECRET` set. Guards `/search` and `/os/*` routes. |
| **OpenSearch** | ✅ Active | `http://10.0.2.147:9200` — open cluster, no credentials. Index: `purchase-requisitions` (knn, dim 384). |
| **Embedding Provider** | ✅ Active | `openai-compatible` · `sentence-transformers/all-MiniLM-L6-v2` · 384 dims · `http://10.0.2.147:8000` |
| **Cache** | ❌ Disabled | Explicitly set to `cache: { enabled: false }` in code. Every request goes directly to OpenSearch. |
| **Valkey / Redis** | ❌ Not configured | `VALKEY_URL` not set. Not needed while cache is disabled. |
| **`/query` route (SQL)** | ❌ Removed | HTTP SQL path disabled. `axis.query()` available internally for future cron jobs only. |

---

## 2. Pre-requisites — Infrastructure

| Service | Required? | Purpose | Notes |
|---|---|---|---|
| **PostgreSQL** (>= 12) | Required | SQL query target (library-level) | `axis.query()` uses this. No HTTP route exposes it currently. |
| **OpenSearch** (>= 2.x) | Required (for this deployment) | Full-text / semantic / hybrid search | `/search` and `/os/*` routes require it. |
| **Embedding Service** | Required (for this deployment) | Vector generation for semantic/hybrid search | `search.type = "semantic"` or `"hybrid"` will fail without it. |
| **Valkey / Redis** | Not in use | Distributed cache | Cache is disabled — not needed. |

---

## 3. Pre-requisites — Runtime & Toolchain

| Requirement | Minimum Version | Reason |
|---|---|---|
| **Node.js** | >= 18 LTS | Axis is ESM-only. Node 18+ handles native ESM and `pkg.exports`. |
| **npm** | >= 9 | Required for `file:` tarball installs (`axis-1.0.0.tgz`). |
| **TypeScript** | >= 5.0 | Axis types use modern TS features. Middleware uses TS 5.6. |
| **tsx** | >= 4.19 | Dev-mode runner (`npm run dev`). Not needed in production. |

---

## 4. Pre-requisites — Project Configuration

### 4.1 ESM Mode — Non-Negotiable

Axis is ESM-only (`"type": "module"`). The consuming project must also be ESM:

```json
{ "type": "module" }
```

Importing from CJS fails with `ERR_REQUIRE_ESM`.

### 4.2 TypeScript Compiler Options

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`module` + `moduleResolution` = `NodeNext` is the only combination that resolves the `exports` field in `axis/package.json`. All relative imports must use explicit `.js` extensions.

### 4.3 Installing the Library

```bash
npm install --save "file:../axis/axis-1.0.0.tgz"
```

After rebuilding axis, re-run `npm pack` inside `axis/` then `npm install` in middleware. A stale `node_modules/axis` is the most common source of broken imports.

---

## 5. Pre-requisites — Environment Variables

| Variable | Required? | Current Value | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Required | `postgresql://postgres:***@localhost:5432/po` | PostgreSQL connection string. |
| `PORT` | Optional | `3000` (default) | HTTP server listen port. |
| `AXIS_JWT_SECRET` | Optional | ✅ Set | Guards `/search` and `/os/*`. When set, every request to those routes must carry `Authorization: Bearer <JWT>`. |
| `OPENSEARCH_URL` | Optional | `http://10.0.2.147:9200` | OpenSearch endpoint. Required for this deployment. |
| `OPENSEARCH_USERNAME` | Optional | Not set | Basic auth username. Open cluster — not needed currently. |
| `OPENSEARCH_PASSWORD` | Optional | Not set | Basic auth password. Open cluster — not needed currently. |
| `OPENSEARCH_INDEX_PREFIX` | Optional | Not set | Prefix prepended to index names. |
| `OPENSEARCH_SSL_REJECT_UNAUTHORIZED` | Optional | `true` (default) | Set `"false"` for self-signed certs. |
| `EMBEDDING_URL` | Optional | `http://10.0.2.147:8000` | Embedding service base URL. Required for semantic search. |
| `EMBEDDING_PROVIDER` | Optional | `openai-compatible` | `"ollama"` or `"openai-compatible"`. |
| `EMBEDDING_MODEL` | Optional | `sentence-transformers/all-MiniLM-L6-v2` | Model name in the embedding container. |
| `EMBEDDING_API_KEY` | Optional | Not set | API key for OpenAI-compatible endpoints. |
| `EMBEDDING_DIMENSIONS` | Optional | `384` | Vector dimensionality. Must match the OpenSearch `knn_vector` mapping. |
| `CACHE_ENABLED` | Optional | Not set (but ignored) | Cache is disabled in code regardless of this variable. |
| `VALKEY_URL` | Optional | Not set | Not needed — cache is disabled. |

---

## 6. What the Middleware Must Provide

### 6.1 Install & Import Axis

All public exports come from a single `"axis"` entry point:

```typescript
import {
  Axis,
  ModelRegistry,
  OpenSearchAdapter,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  defineModel,
  SecurityContextError,
  buildOpenSearchSecurityFilters,
} from "axis";
import type {
  AxisQuery,
  AxisSecurityConfig,
  ModelDefinition,
  EmbeddingProvider,
  SearchAdapter,
  SearchQuery,
  QueryResult,
} from "axis";
```

### 6.2 Define & Register Models

The middleware must define at least one `ModelDefinition` and register it with a `ModelRegistry` before instantiating `Axis`. Every model referenced in a query must be registered before the first request arrives. Queries for unregistered models throw `ResolutionError` (HTTP 422).

```typescript
const registry = new ModelRegistry();
registry.register(PurchaseRequisitions);
```

### 6.3 Instantiate Axis

Cache is disabled. The Axis instance is constructed without any cache backend:

```typescript
const axis = new Axis({
  database: { url: databaseUrl },   // Required
  registry,
  cache: { enabled: false },        // Cache explicitly off
  security,                         // Security mappings (when JWT enabled)
  searchAdapter,                    // OpenSearch adapter
  embeddings: { instance: provider },
});
```

The middleware owns construction entirely. The library never reads `process.env`.

### 6.4 Wire OpenSearch Adapter

Required — the middleware is OpenSearch-only. Without this, `/search` returns 503.

```typescript
import { OpenSearchAdapter } from "axis";

const searchAdapter = new OpenSearchAdapter({
  enabled: true,
  url: process.env.OPENSEARCH_URL,
  // username / password only if cluster requires auth
  ssl: { rejectUnauthorized: true },
});

const axis = new Axis({ database: { url }, cache: { enabled: false }, searchAdapter });
```

Each model must also declare a `search` block with an index name, searchable axes, embedding input axes, and the vector field name.

### 6.5 Wire Embedding Provider

Required for `search.type = "semantic"` or `"hybrid"`. This deployment uses `openai-compatible`:

```typescript
import { OpenAICompatibleEmbeddingProvider } from "axis";

const provider = new OpenAICompatibleEmbeddingProvider({
  baseURL: process.env.EMBEDDING_URL,              // http://10.0.2.147:8000
  model: process.env.EMBEDDING_MODEL,              // sentence-transformers/all-MiniLM-L6-v2
  dimensions: Number(process.env.EMBEDDING_DIMENSIONS), // 384
});

const axis = new Axis({
  database: { url },
  cache: { enabled: false },
  embeddings: { instance: provider },
});
```

For Ollama deployments, swap `OpenAICompatibleEmbeddingProvider` with `OllamaEmbeddingProvider`.

### 6.6 Wire Security & JWT Auth

The library handles authorization (row-level security). The middleware handles authentication (JWT). These are strictly separate concerns — the library never sees tokens.

**Step 1 — Middleware verifies JWT:**
```typescript
import jwt from "jsonwebtoken";
const payload = jwt.verify(token, secret);
// Accepts: { sub, tenantId, roles? }  OR  { userId, tenantId, role? }
```

**Step 2 — Convert claims to AxisContext:**
```typescript
import type { AxisContext } from "axis";
const context: AxisContext = {
  user: payload.sub ?? payload.userId,
  tenant: payload.tenantId ?? payload.tenant,
  roles: payload.roles ?? [],
};
```

**Step 3 — Register security mappings:**
```typescript
const security: AxisSecurityConfig = {
  mappings: {
    tenant: { contextKey: "tenant", column: "tenant_id", sessionKey: "app.tenant_id", required: true },
    user:   { contextKey: "user",   column: "created_by", sessionKey: "app.user_id",  required: true, searchField: "createdBy" },
  },
};
```

**Step 4 — Pass context per request:**
```typescript
app.post("/search", async (req, res) => {
  const context = req.axisContext; // set by auth middleware
  const result = await axis.searchDocuments(req.body, { context });
  res.json(result);
});
```

### 6.7 Expose HTTP Routes

This is the **current active route set** — the `/query` SQL route has been removed. The middleware is OpenSearch-only over HTTP.

| Method | Path | Auth Required? | Description |
|---|---|---|---|
| `GET` | `/health` | No | Liveness probe — `{ ok: true }` |
| `GET` | `/models` | No | Lists all registered models |
| `GET` | `/os/indices` | Yes (JWT) | OpenSearch index names + doc counts |
| `GET` | `/os/docs/:model` | Yes (JWT) | Sample indexed documents (vectors truncated) |
| `POST` | `/search` | Yes (JWT) | Full-text / semantic / hybrid search via `axis.searchDocuments()` |
| `POST` | `/search/:model` | Yes (JWT) | Convenience: model from URL path |

> **Note:** `/query`, all `/cache/*` routes, and `/query/:model` are removed from this deployment.

### 6.8 Handle Errors Correctly

| Error Name | HTTP Status | Trigger |
|---|---|---|
| `ValidationError` | 400 | Malformed `AxisQuery` |
| `SyntaxError` (body-parser) | 400 | Malformed JSON body |
| `AuthError` | 401 / 403 | JWT missing / invalid / expired |
| `SecurityContextError` | 403 | Required security context value absent |
| `ResolutionError` | 422 | Unknown axis/metric, unregistered model |
| `CompilationError` | 422 | Query cannot be compiled to DSL |
| `ExecutionError` | 502 | Search execution failed |
| Other | 500 | Unexpected internal error |

A 4-argument error handler is mandatory — Express identifies error handlers by arity. Register it last:

```typescript
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(statusForError(err)).json({ error: { message: ..., code: ... } });
});
```

### 6.9 Graceful Shutdown

`axis.close()` must be called on shutdown. This drains the PostgreSQL pool and closes all connections to OpenSearch and the embedding provider.

```typescript
async function shutdown(signal: string): Promise<void> {
  server.close();
  await axis.close(); // closes: pg Pool + OpenSearch + embedding provider
  process.exit(0);
}
process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

Not calling `axis.close()` causes the process to hang on exit.

---

## 7. Model Definition Contract

| Field | Type | Required? | Description |
|---|---|---|---|
| `name` | `string` | Required | Unique per registry. Used as `AxisQuery.model`. |
| `source` | `ModelSource` | Required | `table`, `sql`, or `function` variant. |
| `axes` | `Record<string, AxisDefinition>` | Required | Dimensions / group-by fields. |
| `metrics` | `Record<string, MetricDefinition>` | Required | Aggregations. |
| `security` | `ModelSecurity` | Optional | Row-level restriction hook. |
| `search` | `ModelSearchDefinition` | Required (here) | Index name, searchable axes, embedding input, vector field. |
| `description` | `string` | Optional | Shown in `GET /models`. |

**Source variants:**
```typescript
{ type: "table"; table: string }
{ type: "sql"; sql: string }
{ type: "function"; name: string; args?: string[] }
```

**AxisType:** `"string"` | `"number"` | `"boolean"` | `"time"`

**MetricType:** `"count"` | `"countDistinct"` | `"sum"` | `"avg"` | `"min"` | `"max"`

---

## 8. Query DSL Contract

Clients send `AxisQuery` to `/search`. Axis validates at runtime — pass `req.body` directly.

```typescript
interface AxisQuery {
  model: string;        // Required
  axes?: string[];      // GROUP BY (for aggregation search results)
  metrics?: string[];   // Aggregations
  filters?: Filter[];   // WHERE conditions
  orderBy?: OrderBy[];  // Result ordering
  limit?: number;
  offset?: number;
  search?: SearchInput; // Required for /search
  cacheTtl?: number;    // Ignored — cache is disabled
}
```

**SearchInput:**
```typescript
{ type: "fulltext" | "semantic" | "hybrid"; text: string; fields?: string[]; k?: number; }
```

**Filter operators:** `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `isNull`, `isNotNull`

---

## 9. Security Context Contract

When `AXIS_JWT_SECRET` is set, every request to `/search` and `/os/*` must carry `Authorization: Bearer <JWT>`.

**JWT must contain:**
- `sub` or `userId` — user identifier → `AxisContext.user`
- `tenantId` or `tenant` — tenant identifier → `AxisContext.tenant`
- optionally `roles: string[]` or `role: string` → `AxisContext.roles`

Since cache is disabled, there is no cache-key isolation concern. Security context is still applied as PostgreSQL `SET LOCAL` session variables and as OpenSearch term filters on every request.

---

## 10. Feature Matrix

| Feature | Infrastructure | Env Key | Required? | Current Status |
|---|---|---|---|---|
| SQL query (library-level) | PostgreSQL | `DATABASE_URL` | Required | ✅ Active (internal only) |
| HTTP `/query` route | — | — | — | ❌ Removed |
| Cache | — | `CACHE_ENABLED` | No | ❌ Disabled in code |
| Valkey / Redis | Valkey | `VALKEY_URL` | No | ❌ Not configured |
| JWT authentication | — | `AXIS_JWT_SECRET` | No | ✅ Active |
| PostgreSQL RLS (security context) | PG RLS | `security` config | No | ✅ Active |
| Full-text search | OpenSearch | `OPENSEARCH_URL` | No | ✅ Active |
| Semantic search | OpenSearch + Embedding | both URLs | No | ✅ Active |
| Hybrid search | OpenSearch + Embedding | both URLs | No | ✅ Active |
| Document indexing | OpenSearch | `OPENSEARCH_URL` | No | ✅ Active |

---

## 11. Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| `Cannot find module 'axis'` | Stale `.tgz` in `node_modules` | `npm pack` in `axis/`, then `npm install` in middleware |
| `ERR_REQUIRE_ESM` | App is CJS | Add `"type": "module"`, switch TS to `NodeNext` |
| `Database configuration requires 'url' or 'host'` | `DATABASE_URL` is empty | Set the env var |
| `Model "X" is not registered` | `registerModel()` not called | Register all models before first request |
| Semantic search fails: "requires an embedding provider" | No embedding provider | Set `EMBEDDING_URL` + `EMBEDDING_MODEL` |
| Search returns 503 | `searchAdapter` not passed to Axis | Set `OPENSEARCH_URL` |
| JWT 401 on every request | Token expired or wrong secret | Regenerate token; check `AXIS_JWT_SECRET` matches signing key |
| Embedding dimension mismatch | `EMBEDDING_DIMENSIONS` doesn't match OpenSearch mapping | Both must be `384` (or whatever the model outputs) |
| Node process hangs on exit | `axis.close()` not called | Add `SIGINT` / `SIGTERM` handlers |
| Cache appears to be working but results are stale | Cache was previously enabled and MemoryCache has in-flight entries | Cache is now `enabled: false`; ignore — all requests hit OpenSearch |
