# Business Requirements Document (BRD) — Axis Governed Analytics & Search

**Status:** Implemented behaviour as observed in the repository (see linked PRD and API spec).
**Scope:** The whole product as it exists: `axis` library + `axis-middleware` (Express :3000) + `axis-playground` (Next.js :3001).
**Source of truth:** The repository. Anything not evidenced is marked **Needs confirmation**.

Related: [PRD](../01-prd/PRD.md) · [User stories](../02-user-stories/USER_STORIES.md) · [UX flows](../03-ux-flows/UX_FLOWS.md) · [Architecture](../04-architecture/ARCHITECTURE.md) · [Data model](../05-data-model/DATA_MODEL.md) · [API spec](../06-api-spec/API_SPEC.md)

---

## 1. Product vision

**Axis is a governed analytics and search gateway over PostgreSQL, served from OpenSearch and explored from the browser.**

The product rule, stated in the middleware README, is:

> **Clients send JSON DSL, never SQL; HTTP reads hit OpenSearch only.**

A non-technical reading:

- Business data lives in PostgreSQL (the source of truth).
- A background process copies the searchable representation into OpenSearch (the fast read store) and adds vector embeddings for meaning-based search.
- Applications and people query through a small, governed JSON language (model + axes + metrics + filters + search). They never write SQL, never see table names, and never reach the database directly over HTTP.
- A browser playground lets an analyst discover models, build a query visually or paste raw JSON, attach a login token, and inspect the answer.

## 2. Problem being solved

| Problem | How Axis addresses it (implemented) |
|---|---|
| Every dashboard needs hand-written SQL per endpoint; column names leak to clients; one typo breaks a report. | One semantic model per business entity maps friendly names (`department`, `newCount`) to columns/expressions. Clients use names only. See [Data model](../05-data-model/DATA_MODEL.md). |
| Unbounded SQL from clients is a security risk. | The query language has no SQL. Validation rejects unknown models, axes, and metrics before anything executes. |
| One tenant must never see another tenant's rows. | JWT identity → per-request tenant/user context → OpenSearch term filters (and PostgreSQL session settings on the internal SQL path). Fail-closed: missing context returns nothing or an error, never all rows. See [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md). |
| Keyword search misses meaning ("engg" vs "Engineering"). | Full-text, semantic (vector), and hybrid search types. Semantic search embeds the query text with the same model used at index time. |
| Direct database reads are slow for search, filters, and aggregations. | HTTP reads are served from OpenSearch aggregations (`size: 0` for grouped counts) and document queries. SQL over HTTP has been removed. |

## 3. Target users

| User | What they do | Where |
|---|---|---|
| **Analyst / operations reviewer** | Explores requisitions and vendor catalog; groups, filters, searches; checks counts. | Playground (`:3001`) and/or `POST /search` via API client. |
| **Application developer (API consumer)** | Sends JSON DSL from a product backend or script; displays rows/counts. | `POST /search`, `GET /models`, `GET /os/*` on `:3000`. |
| **Data / platform operator** | Seeds PostgreSQL, builds OpenSearch indices, re-indexes, checks index health, rotates secrets. | Scripts in `axis-middleware/scripts/`, `sql/`, server logs. See [Runbook](../13-operations/RUNBOOK.md). |
| **Model owner (governance)** | Defines or changes axes, metrics, and search configuration in code. | `axis-middleware/src/models/*.ts` (middleware-owned). |

There is no end-customer storefront, no shopper, and no checkout user. There are no separate admin / editor / viewer roles in the product: **roles are carried in the token but never checked for allow/deny**. The only enforced boundary is tenant (and user) scoping. See §6.

## 4. Business objectives

1. Serve governed, tenant-isolated analytics and search from OpenSearch with a stable JSON contract.
2. Keep PostgreSQL authoritative while keeping the user read path off the database.
3. Let analysts self-serve without writing SQL (playground + `/models` discovery).
4. Keep authentication (who you are) separate from authorization (which rows you see), so the semantic library stays application-agnostic.
5. Keep operating cost predictable: stateless middleware, no per-request database aggregation, no mandatory cache layer today.

**Needs confirmation:** There is no pricing, packaging, SLA, or revenue target evidenced in the repository. §8 marks this explicitly.

## 5. Scope

### In scope (implemented)

- Semantic models: `PurchaseRequisitions`, `Companies`, `CompanyInfo`, `ContactInfo`, `FinancialInfo`. Full axis/metric lists in [Data model](../05-data-model/DATA_MODEL.md).
- Query DSL: axes (group-by), metrics (aggregations), 14 filter operators, order-by, limit/offset, full-text/semantic/hybrid search. Full contract in [API spec](../06-api-spec/API_SPEC.md).
- Tenant-isolated search (`PurchaseRequisitions`) and shared-catalog search (all four vendor models).
- Logical architectures `A`, `A2` (both OpenSearch-backed) selectable via `X-Axis-Target`; `C` (S3 JSON) stubbed with `501 ArchitectureNotImplemented`.
- Playground: connection, model discovery with index/doc counts, query builder, raw JSON, auth panel with token decode preview, response viewer with timing, light/dark theme.
- Indexing scripts (PostgreSQL → transform → embed → bulk index → refresh), seed scripts, health/diagnostic scripts. See [Runbook](../13-operations/RUNBOOK.md).
- JWT authentication on `/search` and `/os/*` when `AXIS_JWT_SECRET` is set; open mode when empty (local development).

### Non-scope (not in the product)

- SQL over HTTP (`POST /query/*`) — removed (commented out). The library SQL path remains for background/cron use only.
- HTTP caching (`/cache/*`, Memory/Valkey cache on the request path) — removed/disabled. Every request hits OpenSearch. The library cache code still exists but the middleware constructs `Axis` with `cache: { enabled: false }`.
- Notifications, email, webhooks, payments, billing, shopping cart, checkout, user registration, password login, account settings, file uploads, charts/dashboards beyond raw JSON, pagination UI beyond limit/offset inputs.
- Role-based access control (RBAC): `roles` travel in the token and context but no route checks them.
- S3-backed reads (architecture `C`): header is accepted, routing exists, execution returns `501`.
- Scheduler/cron: the background sync design is documented (`AXIS_WORKFLOW.md`) but **Needs confirmation** — no scheduled job file was found; sync is run manually via scripts.

## 6. Business rules

1. **No SQL from clients, ever.** Unknown axes/metrics/filters are rejected with `400 ValidationError` or `422 ResolutionError/CompilationError`.
2. **Model and field names are case-sensitive.** Canonical names come from `GET /models`.
3. **Tenant isolation is fail-closed.** `PurchaseRequisitions` queries without a valid tenant see zero rows (or `401`/`403` when auth is enforced). Foreign tenants see zero rows, never an error leaking data.
4. **Shared catalog is visible to any authenticated caller.** `Companies`, `CompanyInfo`, `ContactInfo`, `FinancialInfo` skip tenant term filters (`security.openSearch.shared: true`, `vendor_companies.tenant_id = 'public'`). Authentication is still required when a secret is configured.
5. **Canned metrics bake their filters.** `pendingCount` means `status equals 1`; `assignedCount` means `hasAssignedBuyer equals true`; `msmeCount` means `msme equals "Yes"`; `micro/small/mediumCount` match `msmeClassification`; turnover metrics sum/average a fixed fiscal column. Callers cannot override the baked filter.
6. **Only `status = 1` has a codified business meaning in the repo ("pending").** All other requisition status numbers are **Needs confirmation**.
7. **`hasAssignedBuyer` / `assignedCount` require the `upeg.requisition_item` table.** The seed database `po` does not include it unless `sql/001_requisition_item_stub.sql` is applied. Queries touching these fields fail at execution until then.
8. **Metric `sql` is the database column; metric `search.field` is the indexed axis key.** When names differ (e.g. `turnover_2025_26` vs `turnover2526`) both must be set or OpenSearch aggregations silently return `0`.
9. **`id` axes are exact (`keyword`) matches.** Other string axes are full-text plus keyword; filtering/grouping uses the keyword variant.
10. **Request size cap is 256 KB** (`express.json({ limit: "256kb" })`). Malformed JSON returns `400 InvalidJson`.
11. **CORS is fully open** (`Access-Control-Allow-Origin: *`) — a local-development posture, not a production policy. See §10 and [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md).

## 7. Functional business requirements

| ID | Requirement | Status |
|---|---|---|
| F-1 | Discover available models, their axes, metrics, index names, and architectures. | Implemented (`GET /models`, `GET /architectures`, playground model cards). |
| F-2 | Run grouped aggregations (e.g. requisitions by department with `newCount`). | Implemented (`POST /search`, answered from OpenSearch aggregations). |
| F-3 | Filter by axis values with the 14 documented operators. | Implemented. |
| F-4 | Full-text search over configured searchable axes. | Implemented. |
| F-5 | Semantic and hybrid search via embeddings. | Implemented (requires embedding service; fails with `502`/`ExecutionError` when unavailable). |
| F-6 | Tenant-isolated requisition search. | Implemented (term filters on `tenant_id`/`created_by`-derived fields). |
| F-7 | Shared vendor catalog visible to any valid token. | Implemented. |
| F-8 | Multi-model (joined) search under architecture `A2` (e.g. `ContactInfo.email` from a `CompanyInfo` root). | Implemented in library + middleware routing; unrelated cross-model references return `422`. |
| F-9 | Inspect index health (`GET /os/indices`) and sample indexed documents (`GET /os/docs/:model`, vectors truncated). | Implemented. |
| F-10 | Build and send queries from the browser with or without code. | Implemented (playground builder + raw JSON). |
| F-11 | Authenticate with JWT; go open (no token) for local development. | Implemented (conditional auth guards). |
| F-12 | Re-index from PostgreSQL; verify seed data. | Implemented as operator scripts (manual, not scheduled). |

## 8. Non-functional business requirements

| Category | Requirement / current posture |
|---|---|
| Performance | Reads from OpenSearch; grouped aggregations use `size: 0`. No latency SLO is evidenced — **Needs confirmation**. Known inefficiency: `terms.size` reuses the row `limit`, which can truncate buckets (see `ISSUES_AND_IMPROVEMENTS.md`). |
| Availability | Stateless Express; liveness at `GET /health`. No redundancy, health-check, or SLO definition evidenced — **Needs confirmation**. |
| Scalability | Pool defaults (`maxConnections: 10`) for the internal SQL path; OpenSearch does the read scaling. No load test evidenced. |
| Security | JWT verification (signature + expiry), fail-closed tenant isolation, parameterized session settings, redacted `500`/`502` messages. Open CORS and optional-auth mode are dev postures — must be tightened before any production rollout. |
| Privacy | Sample-doc and pipeline debug artifacts can carry tenant/user data (`src/reference/indexed-docs.txt`). Treat as sensitive. No retention/deletion policy evidenced — **Needs confirmation**. |
| Operability | Structured start-up log (auth/cache/search/embeddings/architectures), graceful shutdown (`SIGINT`/`SIGTERM` → `axis.close()`), diagnostic scripts. No centralised logging/metrics/alerting evidenced. |
| Portability | ESM-only Node; `axis` consumed via packed tarball (`file:../axis/axis-1.0.0.tgz`) — rebuild → pack → reinstall on every library change. |
| Data quality | Seed data is demo-only (8 requisitions, 30 vendors). No data-quality SLA. |

## 9. Pricing / revenue model

**Needs confirmation.** No pricing, plans, billing, entitlements, usage metering, or revenue logic exists in the repository. There are no payments, subscriptions, or quotas. Do not present the product as monetised until the business confirms a model.

## 10. Assumptions, constraints, risks

**Assumptions**

- PostgreSQL (`po`), OpenSearch, and an embedding service (MiniLM 384-dim or compatible) are reachable where search is used.
- Operators apply `sql/001_*` (requisition-item stub) and `sql/002_*` (vendor view) before indexing the affected models.
- The same embedding model is used at index time and query time (otherwise vector search compares incompatible spaces).
- JWTs are issued by an external identity provider; the middleware only verifies and maps claims.

**Constraints**

- ESM-only (`"type": "module"`, `NodeNext`); CJS consumers fail with `ERR_REQUIRE_ESM`.
- Library changes require `npm run build && npm pack` in `axis/` plus reinstall in `axis-middleware` — forgetting this runs stale code.
- `ModelIndexer` only extracts from table-like sources, so the vendor flattening must stay a view, not raw SQL.
- Embedding dimensions (384) must match the OpenSearch `knn_vector` mapping.

**Risks**

| Risk | Impact | Mitigation / status |
|---|---|---|
| Open CORS + optional auth reaches a shared environment. | Cross-origin calls; unauthenticated reads. | Documented as dev-only; tighten before pilot (see [Security](../09-security-privacy/SECURITY_PRIVACY.md), [Pilot](../12-pilot-rollout/PILOT_PLAN.md)). |
| Stale `.tgz` runs old library code. | Phantom errors, wrong behaviour. | Adopt workspaces or a watch task; checklist in [Runbook](../13-operations/RUNBOOK.md). |
| `assignedCount` queried before stub table exists. | `502` at execution. | Apply stub or hide the metric; guard in pilot. |
| Bucket truncation via `terms.size = limit`. | Under-counted groups. | Separate bucket limit from row limit (backlog). |
| Numeric type split (OpenSearch numbers vs legacy SQL strings). | Consumers comparing paths break. | Canonicalise to JSON-native numbers (backlog). |
| Debug snapshot carries tenant data. | Privacy exposure if committed/shared. | Gitignore pipeline logs; treat file as sensitive. |
| No scheduler. | Stale index if operators forget re-index. | Manual re-index runbook until a scheduler lands. |

## 11. Success metrics (proposed — Needs confirmation)

No metrics are instrumented today. Proposed, to be agreed with stakeholders:

- Query success rate (`2xx / total POST /search`) and `p95` latency by search type (structured vs semantic vs hybrid).
- Tenant-isolation correctness: zero cross-tenant rows in tests and audits.
- Index freshness: time since last successful bulk index per model.
- Analyst self-service: share of queries built in the playground vs hand-written JSON; time from Connect to first successful query.
- Vocabulary coverage: share of requests resolved without `422` (unknown model/field).

## 12. Decisions and change log

| Date / source | Decision |
|---|---|
| Current code (`app.ts`) | HTTP serves OpenSearch only. `POST /query/*` and `/cache/*` routes removed (commented reference blocks kept). |
| Current code (`app.ts`, `server.ts`) | Caching disabled (`cache: { enabled: false }`); every request hits OpenSearch. |
| Current code (`architectures.ts`) | Architectures `A` / `A2` (OpenSearch) + `C` (S3 JSON, `501` stub); default `A2`; selected via `X-Axis-Target`. |
| `REQUIREMENTS.md` | Deployment posture recorded: PG internal-only, JWT active, OpenSearch + embeddings active, Valkey not needed. |
| `ISSUES_AND_IMPROVEMENTS.md` | Multi-axis grouping fixed (nested terms aggs); bucket-limit, numeric-split, pipeline logging, planner dead-code items remain open. |

> This BRD describes implemented behaviour. Planned work and gaps live in [Project plan](../07-project-plan/PROJECT_PLAN.md) and [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md).
