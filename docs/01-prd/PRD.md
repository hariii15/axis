# Product Requirements Document (PRD) — Axis

**Status:** Implemented behaviour as observed in the repository.
**Audience:** Founders, product managers, operations staff, stakeholders — plain language, no engineering-only jargon.
**Terminology (used consistently across all docs):** model · axis (group-by dimension) · metric (aggregation) · filter · order-by · search (fulltext / semantic / hybrid) · architecture (`A`, `A2`, `C`) · datasource (`opensearch`, `s3-json`) · tenant · shared catalog · `AxisContext { user, tenant, roles }`.

Related: [BRD](../00-brd/BRD.md) · [User stories](../02-user-stories/USER_STORIES.md) · [UX flows](../03-ux-flows/UX_FLOWS.md) · [Data model](../05-data-model/DATA_MODEL.md) · [API spec](../06-api-spec/API_SPEC.md) · [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md)

---

## 1. Product overview

Axis has three parts that ship together:

| Part | What it is | Port | What the user sees |
|---|---|---|---|
| `axis` library | Semantic layer: models, validation, query planning, SQL + OpenSearch compilation, indexing, embeddings, security helpers. | — (imported) | Nothing directly; powers the other two. |
| `axis-middleware` | Express API. Owns HTTP, JWT verification, model registration, and wiring to PostgreSQL / OpenSearch / embeddings. | `:3000` | JSON API (`/models`, `/architectures`, `/search`, `/os/*`, `/health`). |
| `axis-playground` | Next.js browser tool ("Postman in the browser"). | `:3001` | Single page: Connection, Query (builder + raw JSON), Auth, Response. |

Dependency direction is strict: **playground → middleware → axis → infrastructure**. The library never sees tokens; the UI never sees SQL; the middleware never builds search queries by hand.

## 2. Roles and permissions

There are no application roles such as admin/editor/viewer. Permissions are data boundaries:

| Identity | How it is established | What it can do |
|---|---|---|
| **Anonymous (open mode)** | No token; only when `AXIS_JWT_SECRET` is empty. | `GET /health`, `/models`, `/architectures`, plus `/search` and `/os/*` (open for local development). |
| **Authenticated user** | `Authorization: Bearer <JWT>` with `sub` (or legacy `userId`) and `tenantId` (or `tenant`); optional `roles` (or legacy `role`). | Everything anonymous can do, plus tenant-scoped requisition search. Any valid token can read the shared vendor catalog. |
| **Foreign tenant** | Valid token with a different `tenantId`. | Sees **zero** `PurchaseRequisitions` rows. Sees the full shared catalog (by design). |
| **Operator** | Shell access to the deployment. | Seeds, indexes, inspects, restarts. See [Runbook](../13-operations/RUNBOOK.md). |

`roles` are carried into `AxisContext.roles` but **no route or model checks them**. Do not describe any feature as "role-restricted" — it is not implemented.

Tenant/user enforcement:

- When auth is enabled, `DEFAULT_SECURITY` maps `tenant → tenant_id (required)` and `user → created_by (required, search field createdBy)`.
- OpenSearch path: term filters merged into every `PurchaseRequisitions` query; skipped for shared-catalog models.
- Internal SQL path (background/cron only): PostgreSQL session variables (`app.tenant_id`, `app.user_id`) set transaction-scoped; RLS policies enforce.
- Missing required context fails closed (`403 SecurityContextError` or zero rows); missing/invalid token fails with `401 AuthError`.

## 3. Features and screens

### 3.1 Health check — `GET /health` (no auth)

- **Expected behaviour:** Always returns `{ "ok": true }` with `200` when the process is up.
- **Empty/error states:** None. If it does not answer, the process is down — see [Runbook](../13-operations/RUNBOOK.md).

### 3.2 Model discovery — `GET /models` (no auth)

- Returns all five registered models with `name`, `dataset`, `axes[]`, `metrics[]`, `description`, and which architectures serve them.
- **Expected behaviour:** Names here are canonical and case-sensitive; copy them into queries.
- **Empty state:** `data: []` means no models registered — a wiring bug; no query can succeed until fixed.

### 3.3 Architecture discovery — `GET /architectures` (no auth)

- Returns `A` (legacy single-model OpenSearch: `Companies`, `PurchaseRequisitions`), `A2` (multi-model OpenSearch: `CompanyInfo`, `ContactInfo`, `FinancialInfo`), `C` (S3 JSON: same three models, stubbed), plus `meta.default: "A2"`.
- **Expected behaviour:** Send `X-Axis-Target: A|A2|C` on `POST /search`. Empty header means `A2`. Unknown value returns `400 UnknownArchitecture`. `C` returns `501 ArchitectureNotImplemented` without touching backends.

### 3.4 Search — `POST /search`, `POST /search/:model` (auth when enabled)

The main product capability. Full contract in [API spec](../06-api-spec/API_SPEC.md); behaviour summary here:

- **Request:** `{ model, axes?, metrics?, filters?, orderBy?, limit?, offset?, search? }`. `model` may come from the URL (`:model` overrides the body). `search` is `{ type: fulltext|semantic|hybrid, text, fields?, k? }`.
- **Rule:** At least one of `axes` / `metrics` / `search` must be present. Search-only (no axes/metrics) is valid on `/search` (it returns documents).
- **Validation rules:**
  - `model` required, non-empty, must be registered or `422`.
  - Every axis/metric/filter-field/order-field must exist on the model (or be a valid `Model.field` joined reference under `A2`) or `422`.
  - Filter operators: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `isNull`, `isNotNull`. `isNull`/`isNotNull` take no value; `in`/`notIn` take arrays (`[]` matches nothing / everything respectively).
  - `orderBy.field` must be a selected axis or metric; `direction` is `asc`/`desc`.
  - `limit` must be a positive integer; `offset` a non-negative integer. Library default `100` when omitted; informational cap `10_000` (not enforced). `/os/docs` clamps `1..1000`.
  - `search.text` must be non-empty when `search` is sent; `search.type` is required.
  - Request body cap 256 KB; malformed JSON is `400 InvalidJson`.
  - `cacheTtl`, if sent, is ignored (caching disabled).
- **Search-type behaviour:**
  - Structured filter/aggregation only (no `search`, or `fulltext`): no embedding service needed.
  - `semantic` / `hybrid`: the server embeds the query text first; requires the embedding service or the request fails with `502`.
  - Grouped aggregations are answered cluster-side (`size: 0`); document queries return up to `limit` hits (default 100).
- **Response:** `{ data: { rows, rowCount }, meta: { model, architecture, datasource, limit?, offset? } }`. OpenSearch numbers are native JSON numbers.
- **Response headers:** `X-Axis-Architecture` and `X-Axis-Datasource` echo the routing decision.
- **Notifications:** None (no email, webhooks, or push).
- **Empty state:** Valid query with no matches returns `rows: [], rowCount: 0` with `200`.
- **Error states:** `400` validation / unknown architecture; `401` missing/bad token; `403` missing security context; `404` unknown route; `422` unknown model/field or unresolvable join; `501` architecture `C`; `502` execution failure (message redacted, cause in server logs); `503` search not configured (no OpenSearch adapter).

### 3.5 Index inspection — `GET /os/indices`, `GET /os/docs/:model` (auth when enabled)

- `/os/indices` returns per-model `{ model, index, docs? | error? }`. Counts are cluster-wide (not tenant-filtered) by design. `503` when search is not configured.
- `/os/docs/:model` returns sample documents with `{ rows: [{ ..._source, _id, _score? }], rowCount }` plus `meta { model, index, total, limit, offset }`.
  - `limit` default `10`, clamped `1..1000`; `offset` default `0`, must be `>= 0`.
  - Unknown model is `422`. Tenant filters apply to `PurchaseRequisitions`; shared models return all tenants.
  - Vector fields are truncated (`{ truncated: true, length, preview: first 8 numbers }`) so responses stay small.

### 3.6 Playground — `GET /` on `:3001` (single page, no login)

Detailed journey in [UX flows](../03-ux-flows/UX_FLOWS.md). Behaviour per panel:

- **Connection card:** Base-URL input (default `http://localhost:3000`) + Connect button. Connects by fetching `/models`, `/os/indices`, `/architectures` in parallel (no auth header). Requires `/models` to succeed; populates model cards (`name`, `index · docs`, `axes`, `metrics`) and roots the builder in the default architecture's first model. Failures show `<message> — is the middleware running?` When index counts are unavailable, a hint says to restart the middleware and hit Connect.
- **Query card (tabs: Query Builder | Raw JSON):**
  - Architecture select (defaults `A2`; falls back to `A/A2/C` when discovery failed); changing it resets axes/metrics/filters/order-by. `C` shows "(not implemented yet — expect 501)".
  - Root-model select constrained to the architecture's members; changing it rebases `Model.field` references instead of dropping them.
  - Axes and Metrics chip grids per member model; root uses bare names, joined models use `Model.field`; multi-model hint shows `root X joins Y,Z (1:N)`.
  - Search type select (`none|fulltext|semantic|hybrid`) + text input; omitted from the payload when `none` or blank.
  - Filters: field + operator (all 14) + value inputs; `isNull`/`isNotNull` disable the value box; `in`/`notIn` hint `[1, 2]`; values are JSON-parsed when possible (`1`, `true`, `[1,2]`) else sent as strings. `+ Add filter` / `✕` remove.
  - Order-by: field + `asc`/`desc`; `+ Add order` / `✕`.
  - Limit (default `"10"`) / Offset (default `"0"`); non-numeric values are omitted.
  - Body preview (pretty JSON) always reflects the builder.
  - Send → `POST {base}/search` with `Content-Type`, `Authorization` (when a token is pasted), and always `X-Axis-Target`. Disabled while sending.
  - Raw JSON tab: free textarea (default example query), Format (pretty-print, silent no-op on invalid), Send (invalid JSON shows `Invalid JSON: …` without sending).
- **Auth card:** Token textarea, Clear button, Decoded-payload preview (`(no token — requests go unauthenticated)` when empty; `(not a decodable JWT)` when malformed), live Headers-sent table.
- **Response card:** `no request sent yet` idle state; otherwise status pill (`ok` green / `err` red / `NETWORK ERROR`), duration in ms, `POST url`, error text when present, and pretty-printed body. No charts or tables — raw JSON only.
- **Theme:** Dark/Light toggle, persisted in `localStorage` (`axis.theme`), defaults to OS preference.
- **Persistence:** `axis.baseUrl` (on successful Connect), `axis.token` (after every send), `axis.theme`.

### 3.7 Operator scripts (no UI)

- `seed-po.ts`: creates `upeg.requisition_deails` and upserts 8 demo rows (6 `tenant-001`, 2 `tenant-002`); re-runnable.
- `seed-vendors.ts`: verifies 30 rows each in `company_info` / `financial_info` / `contact_details` (+ view).
- `index-companies.ts` / `index-a2.ts`: delete + recreate indices from canonical `*.mapping.json`, bulk index, refresh; `--force`, `--no-vectors`, `--limit` variants.
- `sync-companies.ts`: count-compare then full re-index (incremental impossible — no `updated_at`).
- `check-*.ts` / `inspect-po.ts`: read-only verifiers for PostgreSQL, OpenSearch, pipeline, structured and semantic search, indexing.
- `sql/001_requisition_item_stub.sql`, `sql/002_vendor_companies_view.sql`: canonical DDL, applied with `psql "$DATABASE_URL" -f`.

## 4. State transitions and lifecycle

There is no order/ticket lifecycle. The only lifecycles are data and request lifecycles:

- **Data:** PostgreSQL (source of truth) → transform (columns → index fields) → embed (when `embeddingInput` set) → bulk index → `_refresh` → searchable in OpenSearch. Deletions and incremental updates are **Needs confirmation** — current scripts do full re-index; no scheduler or checkpointing was found.
- **Request:** validate → resolve against model → embed query text (semantic/hybrid only) → compile to OpenSearch DSL → execute → normalize (`rows`, `rowCount`) → respond. Failures stop at the first failing stage with the mapped HTTP code (§3.4).
- **Index health:** per-model doc counts via `/os/indices`; no automated alerting.

Status names used consistently: requisition `status` (number; `1` = pending via `pendingCount`), `hasAssignedBuyer` (boolean), vendor `msme` (`Yes`/`No`), `msmeClassification` (`Micro`/`Small`/`Medium`), fiscal turnovers (`turnover2324/2425/2526`).

## 5. Out of scope (explicit)

SQL over HTTP; HTTP caching and cache-management routes; RBAC; user signup/login pages; onboarding; settings/billing; notifications; payments; S3 reads; background scheduler; charts, exports, saved queries, query history, pagination UI, and any mobile app. Anything in this list must not be described as available. Planned items, if any, belong in [Project plan](../07-project-plan/PROJECT_PLAN.md) and are labelled planned, not implemented.
