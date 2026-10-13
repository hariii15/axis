# Pilot Plan — Axis

First shared rollout of the implemented product to one real tenant plus the shared vendor catalog. Assumes M1–M3 hardening from the [Project plan](../07-project-plan/PROJECT_PLAN.md) is done or explicitly risk-accepted. Anything not evidenced is marked **Needs confirmation**.

Related: [BRD](../00-brd/BRD.md) · [Test strategy](../08-test-plan/TEST_STRATEGY.md) · [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md) · [DevOps](../11-devops/DEVOPS.md) · [Runbook](../13-operations/RUNBOOK.md)

---

## 1. Pilot goal and scope

- Goal: prove tenant-isolated requisition search + shared catalog search + analyst self-service work with real identities and data.
- In scope: `POST /search` (structured + full-text + semantic/hybrid), `GET /models` + `/architectures` + `/os/indices` + `/os/docs`, playground builder/raw JSON/auth/response, operator seed/index/check scripts.
- Out of scope: SQL over HTTP, HTTP caching, RBAC, S3 (`C`) reads, notifications, billing, saved queries, charts/exports, scheduler (manual re-index cadence with an owner instead).

## 2. Entry criteria

1. `sql/001` decision made (stub applied or `hasAssignedBuyer`/`assignedCount` hidden); `sql/002` view applied.
2. Non-`1` requisition status codes and turnover fiscal mapping confirmed with the business.
3. `AXIS_JWT_SECRET` set and rotation tested; CORS restricted; OpenSearch credentials/TLS verified; debug snapshot removed or gitignored.
4. Indices rebuilt from canonical mappings with the pinned embedding model (384 dims matched); `/os/indices` counts recorded.
5. Auth matrix green: spec + legacy tokens × valid/expired/wrong-secret/missing × own/foreign/no tenant; shared catalog visible to any valid token; zero cross-tenant requisition rows.
6. Legal drafts ([Terms](../10-legal/TERMS_OF_USE.md), [Privacy](../10-legal/PRIVACY_POLICY.md)) reviewed enough to cover pilot data; retention/erasure owners named.
7. Rollback tested: previous `axis-*.tgz` + mappings + index snapshot restorable; re-index path timed.

## 3. Pilot steps (2-week shape — Needs confirmation on dates)

| Phase | Actions | Success check |
|---|---|---|
| Week 1 — readiness | Harden (bucket-limit, numeric canonicalisation), pipeline logging with correlation IDs, startup schema checks, workspace/watch fix, docs refresh. | Regression tests green; probes green in staging. |
| Week 1 — data | Load pilot tenant rows + vendor snapshot; full re-index + refresh; record counts. | `/os/indices` matches source counts; sample docs verified. |
| Week 2 — users | Issue pilot JWTs; train analysts (Connect → builder → raw JSON → auth → response); collect time-to-first-query. | Analysts self-serve without SQL; `422` rate (unknown fields) low. |
| Week 2 — operation | Manual re-index cadence executed; health reviewed daily; incidents run through the Runbook. | Index freshness within agreed window; zero cross-tenant findings. |
| Exit review | Decide: expand, extend pilot, or roll back. | Metrics in §5 met or gaps owned. |

## 4. Roles

Pilot owner (go/no-go) · business stakeholder (status codes, catalog scope) · operator (seed/index/health/secrets) · analyst cohort (queries + feedback) · reviewer for tenant-isolation audit · legal contact (terms/privacy). Names and on-call coverage: **Needs confirmation**.

## 5. Success metrics (agree targets before start — Needs confirmation)

- Query success rate and `p95` latency by search type; embedding failure rate.
- Tenant-isolation audit: zero foreign-tenant rows across sampled queries.
- Index freshness: hours since last successful bulk index per model.
- Self-service: median minutes from Connect to first `200`; share of builder vs raw JSON queries.
- Vocabulary fit: share of requests without `422`; top unknown fields fed back to the model owner.

## 6. Risks and rollback

Risks: stale-`tgz` deploy, bucket-truncation under-counts, `assignedCount` `502`, embeddings outage (`502` on semantic/hybrid), open CORS/secret mishandling, stale index without a scheduler. Mitigations in [BRD §10](../00-brd/BRD.md) and [Runbook](../13-operations/RUNBOOK.md).

Rollback: stop traffic → restore previous tarball + mappings → re-index + refresh → re-probe per the DevOps checklist → confirm counts → post-mortem. Data changes during pilot (re-index is full, not incremental) must be reconciled — **Needs confirmation** on the source-of-truth freeze policy.
