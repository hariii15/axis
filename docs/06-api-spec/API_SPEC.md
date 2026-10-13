# API Specification — Axis Middleware

Observable HTTP capabilities only. Nothing here is invented: removed routes (`/query/*`, `/cache/*`) are documented as removed. For behaviour context see [PRD](../01-prd/PRD.md) and [Data model](../05-data-model/DATA_MODEL.md).

Base URL defaults to `http://localhost:3000`. All bodies are JSON (`express.json({ limit: "256kb" })`). CORS: `Allow-Origin *`, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, headers `Content-Type,Authorization,X-Axis-Target`, exposed `X-Axis-Architecture,X-Axis-Datasource`. Preflight `OPTIONS /*` returns `204`.

Auth rule: when `AXIS_JWT_SECRET` is set, `/search` and `/os/*` require `Authorization: Bearer <JWT>`; `/health`, `/models`, `/architectures` never do. When the secret is empty, everything is open (local dev).

JWT claims accepted: spec `{ sub, tenantId, roles? }` or legacy `{ userId, tenantId, role? }` (`tenant` is also accepted as an alias of `tenantId`). `roles` may be an array; `role` a single string.

---

## 1. `GET /health` — no auth

- Response `200`: `{ "ok": true }`.

## 2. `GET /models` — no auth

- Response `200`: `{ "data": [{ "name", "dataset", "axes": string[], "metrics": string[], "description", "architectures": ("A"|"A2"|"C")[] }] }`.
- `dataset` is `model.dataset ?? name.toLowerCase()`; `architectures` filtered from `ARCHITECTURE_MODELS`.

## 3. `GET /architectures` — no auth

- Response `200`: `{ "data": [{ "name": "A"|"A2"|"C", "datasource": "opensearch"|"s3-json", "models": string[], "default": boolean }], "meta": { "default": "A2" } }`.

## 4. `GET /os/indices` — auth when enabled

- Response `200`: `{ "data": [{ "model", "index", "docs"?: number, "error"?: string }] }` (counts cluster-wide; per-model error when that index fails).
- Errors: `503 { code: "SearchNotConfigured" }` when no OpenSearch adapter.

## 5. `GET /os/docs/:model?limit=&offset=` — auth when enabled

- Params: `:model` must be registered or `422`; `limit` default `10`, clamp `1..1000`; `offset` default `0`, must be `>= 0`.
- Behaviour: tenant filters apply unless the model is shared or no security context; `trackTotalHits: true`; vector fields truncated to `{ truncated: true, length, preview: number[0..8] }`.
- Response `200`: `{ "data": { "rows": [{ "..._source", "_id", "_score"? }], "rowCount" }, "meta": { "model", "index", "total", "limit", "offset" } }`.

## 6. `POST /search` and `POST /search/:model` — auth when enabled

`:model` (when present) overrides `body.model` (`{ ...body, model: param }`).

### 6.1 Request contract (`AxisQuery` + search)

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"],
  "filters": [{ "field": "status", "operator": "equals", "value": 1 }],
  "orderBy": [{ "field": "newCount", "direction": "desc" }],
  "limit": 10,
  "offset": 0,
  "search": { "type": "hybrid", "text": "Engineering", "fields": ["department"], "k": 10 }
}
```

| Field | Rules |
|---|---|
| `model` | Required, non-empty string, must be registered. |
| `axes` / `metrics` | Arrays of non-empty strings; must exist on the model (or valid `Model.field` under `A2`). At least one of `axes` / `metrics` / `search` required. |
| `filters[]` | `{ field (axis name, not column), operator, value? }`. Operators: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `isNull`, `isNotNull`. `isNull`/`isNotNull` omit `value`; `in`/`notIn` take arrays (`[]` → match nothing / everything). Values: `string \| number (not NaN) \| boolean \| null \| homogeneous arrays`. |
| `orderBy[]` | `{ field (selected axis or metric), direction: "asc" \| "desc" }`. |
| `limit` / `offset` | `limit` positive int; `offset` non-negative int. Omitted → library default `100` / `0`. Unknown keys stripped, not rejected. |
| `search` | `{ type: "fulltext" \| "semantic" \| "hybrid", text (non-empty), fields?: string[], k?: positive int }`. `semantic`/`hybrid` require the embedding service. |
| `cacheTtl` | Accepted but ignored (caching disabled). |

Headers: `X-Axis-Target: A | A2 | C | (empty = A2)`. Unknown → `400`. `C` → `501` before touching backends.

### 6.2 Success response

- Status `200`, headers `X-Axis-Architecture`, `X-Axis-Datasource`.
- Body: `{ "data": { "rows": object[], "rowCount": number }, "meta": { "model", "architecture": "A"|"A2", "datasource": "opensearch", "limit"?, "offset"? } }`.
- Grouped aggregations use OpenSearch `size: 0`; document queries use `size = limit || 100`; `_source` narrowed to requested axes; numbers native.

Example:

```json
POST /search
{ "model": "PurchaseRequisitions", "axes": ["department"], "metrics": ["newCount"], "limit": 10 }
→ { "data": { "rows": [{ "department": "Chemical", "newCount": 1 }], "rowCount": 4 },
    "meta": { "model": "PurchaseRequisitions", "architecture": "A2", "datasource": "opensearch" } }
```

### 6.3 Error envelope

All errors: `{ "error": { "message", "code", "issues"? } }`.

| HTTP | Code | When |
|---|---|---|
| `400` | `InvalidJson` | Malformed JSON body. |
| `400` | `ValidationError` (+ `issues[{path,message}]`) | Bad query shape. |
| `400` | `UnknownArchitecture` | Bad `X-Axis-Target`. |
| `401` | `AuthError` | Missing/malformed/expired/bad-signature JWT; missing context. (`500` only when the secret itself is unconfigured.) |
| `403` | `SecurityContextError` | Required tenant/user context missing or non-scalar. |
| `404` | `NotFound` | `Not found: METHOD path`. |
| `422` | `ResolutionError` / `CompilationError` | Unregistered model, unknown axis/metric/filter/order field, unresolvable join, uncompilable query. |
| `501` | `ArchitectureNotImplemented` | Architecture `C`. Body suggests retrying with `A2`. |
| `502` | `ExecutionError` / `DatabaseError` | Search/embedding execution failed. Message redacted (`Query failed. Check server logs for details.`); cause in server logs. |
| `503` | `SearchNotConfigured` | No OpenSearch adapter (`OPENSEARCH_URL` unset). |
| `500` | `InternalError` | Anything else; message redacted. |

## 7. Removed endpoints (do not use)

- `POST /query`, `POST /query/:model` — removed (commented block). Old behaviour: direct SQL via `axis.query` with transparent cache. Returns `404` today.
- `GET /cache/stats`, `GET /cache/entries`, `GET /cache/key`, `POST /cache/reset-stats`, `DELETE /cache/:model`, `DELETE /cache` — removed (commented block). `Axis` is built with `cache: { enabled: false }`.

## 8. Worked examples

```bash
# discovery (no auth)
curl localhost:3000/health
curl localhost:3000/models
curl localhost:3000/architectures

# grouped aggregation (auth when enabled)
curl -X POST localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "X-Axis-Target: A2" \
  -d '{"model":"PurchaseRequisitions","axes":["department"],"metrics":["newCount"],"limit":10}'

# filtered + searched (semantic needs embeddings)
curl -X POST localhost:3000/search/PurchaseRequisitions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"axes":["department"],"metrics":["newCount"],
       "filters":[{"field":"status","operator":"equals","value":1}],
       "search":{"type":"hybrid","text":"Engineering"},"limit":10}'

# index inspection
curl -H "Authorization: Bearer $JWT" "localhost:3000/os/docs/Companies?limit=5"
```

**Needs confirmation:** No versioning (`/v1`), rate limits, or pagination tokens exist. `limit`/`offset` is the only paging mechanism.
