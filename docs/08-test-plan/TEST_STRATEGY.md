# Test Strategy — Axis

Based on the real suites: `axis` unit/integration tests (validator, AST, resolver, compilers, adapters, embeddings, indexing, planner, security, cache) and `axis-middleware` tests (`auth`, `legacy-context`, `architectures`, `axis`, `purchase-requisitions`, `cache`, `search`, `e2e-searchAndFilter`), plus `check-*.ts` / `seed-*.ts` diagnostic scripts and the playground as a manual harness.

Related: [PRD](../01-prd/PRD.md) · [API spec](../06-api-spec/API_SPEC.md) · [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md) · [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md)

---

## 1. Test levels

| Level | What | Where | Status |
|---|---|---|---|
| Unit | DSL validation (shapes, operators, `isNull` arity, `in` arrays, limit/offset, search object, unknown-key stripping); AST building; single-model resolution; OpenSearch/SQL compilation; cache keys (dedup/sort, security digests, `structuredClone`); memory/valkey backends; embeddings providers; transformer (`search.field` mapping, numeric coercion). | `axis/tests/**` | Implemented. |
| Contract | Compiled OpenSearch DSL shape (nested terms aggs for multi-axis, `size: 0` for aggs, keyword vs text fields, kNN filter); normalized rows (`rows`, `rowCount`, native numbers); error names (`ValidationError`, `ResolutionError`, `CompilationError`, `ExecutionError`, `SecurityContextError`). | `axis/tests/compiler/*`, `search/*`, `playground/pipeline.test.ts` | Implemented. |
| Integration (middleware) | Route wiring: `/models`, `/architectures`, `X-Axis-Target` `400`/`501`, cross-model `422` vs valid joined refs, `/os/indices` + `/os/docs` (limits, truncation, tenant filtering), `/search` aggregations/filters/search types, tenant isolation (tenant-001 vs tenant-002 vs foreign → zero rows). | `axis-middleware/tests/*` | Implemented. |
| Auth/security | Spec + legacy JWT shapes, bad signature/expiry/missing claims/header format, context mapping, middleware attach/forward, fail-closed missing context, RLS transaction (`BEGIN`/`set_config`/`COMMIT`, injection safety), cache-key isolation (library-level; middleware path disabled). | `*/security/*`, `auth.test.ts`, `legacy-context.test.ts` | Implemented. |
| End-to-end (live) | Bulk-index then assert search/filter/aggregation behaviour against real OpenSearch (+ PostgreSQL for the internal SQL path); semantic E2E needs embeddings. | `e2e-searchAndFilter.test.ts`, `check-*.ts` scripts | Implemented (require live services). |
| Manual (playground) | Connect → builder → raw JSON → auth → response inspection; theme; empty/error states. | `:3001` | Implemented as harness; no automated browser tests. |

## 2. Entry / exit criteria

- Entry: services reachable per test tier (unit needs none; middleware integration needs or mocks PG/OS; E2E needs PG `po` + OpenSearch + embeddings); `axis` rebuilt + packed + reinstalled when the library changed; `sql/001` + `sql/002` applied for affected suites; indices refreshed.
- Exit (today): `npm run build` clean (`tsc`) and `npm run test` (`vitest run`) green in the touched package; E2E green where live services exist.
- Exit (pilot gate, planned): M1 correctness fixes covered by regression tests (bucket-limit, numeric-split, `assignedCount` absence); auth matrix green (valid/expired/wrong-secret/missing/legacy/spec × own/foreign/no tenant); no cross-tenant rows; `502`/`503` paths exercised (embeddings down, OS down).

## 3. Test data

- Requisitions: `seed-po.ts` — 8 rows, deterministic IDs/departments/statuses/owners/tenants; re-runnable (`ON CONFLICT DO NOTHING`).
- Vendors: `seed-vendors.ts` verifies 30/30/30 rows; `generate_vendors.py` / `seed_6000.py` / `vendor_seed_*.sql` are legacy/bulk variants — confirm which is canonical before pilot (**Needs confirmation**).
- Indices: `purchase-requisitions` (knn 384), `companies`, `companyinfo`, `contactinfo`, `financialinfo` from canonical `scripts/*.mapping.json`.
- Negative data: foreign-tenant tokens, missing `requisition_item` table (documents `502` on `assignedCount`), dimension-mismatched embeddings.

## 4. Environments

| Env | Services | Auth | Data |
|---|---|---|---|
| Dev (default) | Local PG + open OpenSearch + embedding container | Open (empty secret) | Demo seeds. |
| Authenticated dev | Same + `AXIS_JWT_SECRET=axis-local-secret` | Enforced | Demo seeds; hand-minted JWTs. |
| Pilot | Hardened (see Pilot plan) | Enforced, rotated secret | Real tenant IDs + shared catalog snapshot. |

## 5. Non-functional testing (planned — mostly missing today)

- Performance: `p95` by search type; aggregation vs document latency; embedding latency isolation. No SLO or load test evidenced — **Needs confirmation**.
- Security: CORS, body-limit, token-expiry, redaction (`500`/`502` bodies), log-scrubbing, secret handling. Partly covered (auth tests); deployment checks manual.
- Resilience: OS down → `503`; embeddings down → `502`; PG down (internal path); shutdown drains (`axis.close()`); stale-`tgz` detection. Scripts cover some; chaos/contract coverage is a backlog item.
- Accessibility/UX: playground has no automated a11y tests; manual keyboard/label check recommended before pilot.

## 6. Known gaps (from `ISSUES_AND_IMPROVEMENTS.md`)

1. Search-only on the wrong endpoint gave a misleading error (moot since `/query` removal, but raw-client guidance still needed).
2. Multi-axis grouping fixed — keep the nested-agg regression test.
3. `terms.size = limit` bucket truncation — needs a failing-then-passing test.
4. No pipeline log — add log-shape assertions when the logger lands.
5. Numeric split across paths — needs a cross-path contract test (decide canonical numbers).
6. `requisition_item` absence — needs a startup-check test or field-removal.
7. Stale-`tgz` — process fix, not a test fix.
8. `trackTotalHits`/`size` defaults — assert `total` exactness where claimed.
9. Dead planner — either route through `plan()` with policy tests or delete.
10. Security-branch asymmetry (SQL unconditional vs OS conditional) — one test per path per token case.

## 7. Regression policy

Every fix for items above lands with a regression test in the owning package (`axis` for compiler/security/cache/indexing; `axis-middleware` for routes/auth/architectures). Keep `README/WORKFLOW/OPENSEARCH` updated with each pipeline change so docs do not rot into the next stale artifact.
