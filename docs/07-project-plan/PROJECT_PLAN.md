# Project Plan — Axis

Based on the real application's current maturity: the governed-search product is implemented and demo-seeded; hardening, scheduler, and production-readiness work remain. Items are labelled **Implemented**, **Planned** (needed, not started or partial), or **Idea** (optional). Dates are not committed — **Needs confirmation** by stakeholders.

Related: [BRD](../00-brd/BRD.md) · [Test strategy](../08-test-plan/TEST_STRATEGY.md) · [DevOps](../11-devops/DEVOPS.md) · [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md) · [Runbook](../13-operations/RUNBOOK.md)

---

## 1. Where we are (implemented)

- Semantic library (`axis`): models, validation, AST, resolver (single + joined), SQL + OpenSearch compilers, planner (unused), indexer/transformer/bulk, embeddings providers, security resolver, cache (unused by middleware).
- Middleware: `/health`, `/models`, `/architectures`, `/search(/:model)`, `/os/indices`, `/os/docs/:model`; JWT verification + `AxisContext`; `A`/`A2` routing + `C` stub; disabled cache; graceful shutdown.
- Playground: single page with Connection, builder/raw JSON, Auth, Response, theme, `localStorage` persistence.
- Data: 5 models, canonical mappings, seed scripts (8 requisitions, 30 vendors), `sql/001` + `sql/002`, check scripts; suite cited at ~273 middleware + library tests.
- Docs: README/REQUIREMENTS/ARCHITECTURE/WORKFLOW/OPENSEARCH/Auth/caching notes + `ISSUES_AND_IMPROVEMENTS.md` (the authoritative gap list).

## 2. Milestones (planned)

| Milestone | Goal | Exit criteria |
|---|---|---|
| M1 — Correctness hardening | Fix known wrong behaviour before any rollout. | `terms.size` decoupled from row `limit`; numeric canonicalisation (native numbers); `/os/docs` `trackTotalHits` documented or set; `hasAssignedBuyer` either stubbed everywhere or hidden with a clear error. |
| M2 — Operability | Make failures diagnosable. | JSON-lines pipeline log per request (truncate vectors, cap rows, gitignored); `502` correlation IDs; start-up schema check (warn on missing `requisition_item`, `business_unit` absence already asserted). |
| M3 — Security posture | Dev posture → pilot posture. | CORS restricted; open mode blocked in non-dev; secret rotation runbook exercised; debug snapshot (`indexed-docs.txt`) removed or gitignored; penetration of auth matrix (see Test strategy). |
| M4 — Freshness | Index stays current without heroics. | Either a scheduled sync job with checkpoints (needs `updated_at` or equivalent — schema change) or a documented manual cadence with ownership; `sync-companies` incremental story decided. |
| M5 — Pilot | One real tenant + shared catalog live. | Pilot plan executed; success metrics agreed; rollback tested. See [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md). |
| M6 — Developer experience | Stop stale-code incidents. | Workspace symlink or watch task replacing build→pack→reinstall; planner either wired or deleted; caching docs archived so nobody follows removed routes. |

Ideas (not committed): saved queries/history, charts/CSV export, S3 (`C`) reads, re-enabled security-aware cache, RBAC, rate limiting, API versioning.

## 3. Work breakdown (planned items only)

1. Query correctness: bucket-limit separation; cross-path numeric contract test; multi-axis nested-agg regression coverage (already fixed — keep covered).
2. Observability: request log (raw → AST → resolved → DSL → OS `took/total` → rows → status/duration); redacted client errors keep correlation IDs.
3. Security: CORS allow-list; fail-closed when secret missing in staging/prod; `roles` policy decision (enforce or remove from docs); RLS policy review for the internal SQL path.
4. Data: decide `requisition_item` (real table vs stub vs remove fields); confirm non-`1` status codes; confirm turnover fiscal mapping; add `updated_at` if incremental sync desired.
5. Tooling: workspace or watch; archive stale cache/route docs; keep `README/WORKFLOW/OPENSEARCH` updated per change (per `ISSUES_AND_IMPROVEMENTS.md` opinion 11).
6. Legal/privacy: retention/deletion/DPA answers; see [Legal](./../10-legal/README.md) — all **Needs confirmation**.

## 4. Dependencies and risks

- Embedding model + dimension (384) must stay pinned across index and query; OpenSearch mapping must match.
- `vendor_companies` must remain a view (indexer needs table-like sources).
- ESM-only toolchain; Node 20+; tarball workflow until workspaces land.
- No scheduler exists — freshness depends on operators until M4.
- Risks and mitigations: see [BRD §10](../00-brd/BRD.md).

## 5. Assumptions and unknowns

- Assumes external IdP issues JWTs with `sub`/`tenantId` (+ optional roles); token issuance and rotation are out of scope.
- Assumes OpenSearch ≥ 2.x, PostgreSQL ≥ 12, reachable embedding service.
- Unknowns requiring business/legal review: pricing, SLA/SLO, support model, data-retention and erasure policy, production topology, backup/restore, audit-log retention. All marked **Needs confirmation** where they appear.
