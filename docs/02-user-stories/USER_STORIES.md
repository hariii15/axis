# User Stories — Axis

Conventions: each story has an ID, persona, goal, acceptance criteria, priority (P0 must-have / P1 should-have / P2 nice-to-have), and dependencies. Priorities reflect the implemented product (P0 = core behaviour that exists and must keep working). Anything not implemented is labelled **Planned** or **Idea**.

Related: [PRD](../01-prd/PRD.md) · [UX flows](../03-ux-flows/UX_FLOWS.md) · [API spec](../06-api-spec/API_SPEC.md)

Personas: **Analyst** (operations reviewer) · **API consumer** (application developer) · **Operator** (platform/data) · **Model owner** (governance).

---

## Epic A — Discovery ("what can I ask?")

- **US-A1 · Analyst · See available models and their fields · P0 · depends on: none**
  As an Analyst, I want to see every model with its axes, metrics, index, and doc count so I ask only valid questions.
  Acceptance: Connect shows one card per model from `GET /models` joined with `GET /os/indices`; axes/metrics listed verbatim; unknown index shows `?`. Implemented in playground Connection card.

- **US-A2 · API consumer · List models and architectures programmatically · P0 · depends on: US-A1**
  As an API consumer, I want `GET /models` and `GET /architectures` without auth so my client can validate names before sending queries.
  Acceptance: `200` with `data[]`; architecture entries include `name`, `datasource`, `models[]`, `default`; `meta.default` is `"A2"`. Implemented.

- **US-A3 · Analyst · Inspect sample indexed documents · P0 · depends on: US-A1**
  As an Analyst, I want sample docs with truncated vectors so I can confirm field names and tenant scoping.
  Acceptance: `GET /os/docs/:model?limit=&offset=` returns `rows`, `rowCount`, `meta{model,index,total,limit,offset}`; vectors truncated to 8-number preview; unknown model `422`; tenant filter applies to requisitions only. Implemented.

## Epic B — Structured analytics ("group, filter, count")

- **US-B1 · Analyst · Group requisitions by department with counts · P0 · depends on: US-A1**
  As an Analyst, I want `axes: ["department"], metrics: ["newCount"]` so I see per-department totals.
  Acceptance: `POST /search` returns one row per department with native-number counts, answered cluster-side. Implemented (playground builder + raw JSON).

- **US-B2 · Analyst · Filter on any axis with clear operators · P0 · depends on: US-B1**
  As an Analyst, I want all 14 operators (`equals` … `isNotNull`) with `isNull`/`isNotNull` needing no value so I can narrow results without SQL.
  Acceptance: value box disables for `isNull`/`isNotNull`; `in: []` matches nothing; invalid field/operator rejected `400`/`422`. Implemented.

- **US-B3 · Analyst · Sort and page through results · P0 · depends on: US-B1**
  As an Analyst, I want order-by (selected axis/metric, `asc`/`desc`) plus limit/offset so I can page large answers.
  Acceptance: ordering applies server-side; non-numeric limit/offset omitted by playground; `/os/docs` clamps `1..1000`. Implemented.

- **US-B4 · Analyst · Use canned metrics without redefining filters · P0 · depends on: US-B1**
  As an Analyst, I want `pendingCount` (= `status 1`), `assignedCount`, `msmeCount`, `micro/small/mediumCount`, turnover sums/averages so definitions stay governed.
  Acceptance: metric values match their baked filters; definitions visible in `GET /models`. Implemented. Note: `assignedCount` needs the `requisition_item` stub or it fails at execution.

## Epic C — Search ("find by words and meaning")

- **US-C1 · Analyst · Full-text search · P0 · depends on: US-A1**
  As an Analyst, I want `search: { type: "fulltext", text }` over searchable axes so keyword queries work without embeddings.
  Acceptance: works with no embedding service; `fields?`/`k?` honoured when sent. Implemented.

- **US-C2 · Analyst · Semantic search · P0 · depends on: US-A1**
  As an Analyst, I want `type: "semantic"` so "engg" finds "Engineering".
  Acceptance: server embeds query text with the index-time model; fails `502` with server-log cause when embeddings unavailable. Implemented.

- **US-C3 · Analyst · Hybrid search · P1 · depends on: US-C1, US-C2**
  As an Analyst, I want `type: "hybrid"` combining keyword and vector signals.
  Acceptance: same embedding requirement as semantic; response shape identical. Implemented.

- **US-C4 · Analyst · Search-only document lookup · P0 · depends on: US-C1**
  As an Analyst, I want to send only `search` (no axes/metrics) to `/search` and get documents back.
  Acceptance: valid on `/search`; the retired `/query` path rejected this shape (one reason it was removed). Implemented.

## Epic D — Multi-model (architecture A2)

- **US-D1 · Analyst · Pick architecture and root model · P0 · depends on: US-A1**
  As an Analyst, I want to choose `A`/`A2` (and see that `C` is stubbed) and a root model within it so queries route correctly.
  Acceptance: `X-Axis-Target` always sent (empty = `A2`); unknown arch `400`; `C` returns `501` with "Retry with A2"; changing architecture resets builder fields. Implemented.

- **US-D2 · Analyst · Reference joined fields as `Model.field` · P1 · depends on: US-D1**
  As an Analyst, I want root fields bare and joined fields qualified (e.g. `ContactInfo.email` from `CompanyInfo`) with a visible `root X joins Y,Z (1:N)` hint.
  Acceptance: changing root rebases references; unrelated cross-model references return `422`. Implemented.

## Epic E — Authentication and isolation

- **US-E1 · API consumer · Call with JWT · P0 · depends on: none**
  As an API consumer, I want `Authorization: Bearer <JWT>` with `{ sub|userId, tenantId|tenant, roles?|role? }` so my tenant's rows come back.
  Acceptance: valid token `200`; missing/malformed/expired/wrong-secret `401`; legacy and spec claim shapes both accepted. Implemented.

- **US-E2 · Analyst · Paste a token in the browser · P0 · depends on: US-E1**
  As an Analyst, I want to paste a JWT, see its decoded payload and the exact headers to be sent, and clear it when done.
  Acceptance: empty shows `(no token — requests go unauthenticated)`; malformed shows `(not a decodable JWT)`; headers table previews `Bearer {first18}…`. Implemented in Auth card.

- **US-E3 · Tenant member · See only my tenant's requisitions · P0 · depends on: US-E1**
  As a tenant member, I want foreign tenants to see zero of my requisition rows.
  Acceptance: tenant-001 token sees 6 demo rows, tenant-002 sees 2, foreign sees 0; shared catalog unaffected. Implemented (term filters; fail-closed).

- **US-E4 · Vendor viewer · Read the shared catalog with any valid token · P0 · depends on: US-E1**
  As a vendor viewer, I want all 30 vendors regardless of my tenant.
  Acceptance: any valid token sees all companies; auth still required when a secret is set. Implemented (`openSearch.shared`).

## Epic F — Playground productivity

- **US-F1 · Analyst · Build queries without writing JSON · P0 · depends on: US-A1**
  As an Analyst, I want chips for axes/metrics, dropdowns for filters/order, and a live body preview so I never hand-write a payload.
  Acceptance: preview always matches what Send posts; Send disabled while sending; response shows status, ms, URL, and pretty body. Implemented.

- **US-F2 · API consumer · Paste and format raw JSON · P0 · depends on: US-A1**
  As an API consumer, I want a raw textarea with Format and Send so I can reproduce client payloads exactly.
  Acceptance: Format pretty-prints valid JSON and no-ops on invalid; invalid Send shows `Invalid JSON: …` without a request. Implemented.

- **US-F3 · Analyst · Keep my connection, token, and theme · P2 · depends on: none**
  As an Analyst, I want base URL, token, and theme remembered in `localStorage` so I resume quickly.
  Acceptance: keys `axis.baseUrl`, `axis.token`, `axis.theme`; Clear removes the token. Implemented.

## Epic G — Operations

- **US-G1 · Operator · Seed and index from scratch · P0 · depends on: none**
  As an Operator, I want `seed-po`, `seed-vendors`, canonical `sql/*`, and `index-*` scripts so I can rebuild `po` → OpenSearch deterministically.
  Acceptance: re-runnable seeds; delete+recreate indices from `*.mapping.json`; refresh before serving. Implemented (manual scripts).

- **US-G2 · Operator · Check health and diagnose failures · P0 · depends on: US-G1**
  As an Operator, I want `GET /health`, `/os/indices`, `check-*.ts` scripts, start-up logs, and redacted client errors with full server logs.
  Acceptance: `502`/`500` bodies redacted; causes in logs; shutdown drains pool. Implemented.

- **US-G3 · Model owner · Change a model safely · P1 · depends on: US-G1**
  As a Model owner, I want models owned in `src/models/*.ts` with `metric.sql` vs `search.field` pairs and `exact` flags documented so renames do not silently zero aggregations.
  Acceptance: `GET /models` reflects the change; re-index required; `vendor_companies` stays a view (indexer needs table-like sources). Implemented as convention.

## Planned / Ideas (not implemented — do not sell as available)

- **US-P1 (Planned — Needs confirmation)** · Analyst · Save, name, and re-run queries; see query history. No saved-query storage exists today.
- **US-P2 (Planned — Needs confirmation)** · Analyst · Charts, CSV export, and real pagination UI. Today: raw JSON + limit/offset only.
- **US-P3 (Idea)** · Operator · Scheduled incremental sync with checkpoints instead of manual full re-index. No scheduler file exists today.
- **US-P4 (Idea)** · Platform · Re-enable a security-aware cache layer and `GET /cache/*` introspection. Today caching is disabled by design.
- **US-P5 (Idea)** · Platform · Serve architecture `C` (S3 JSON) reads. Today `C` returns `501`.
