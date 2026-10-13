# Security & Privacy — Axis

Implemented controls as observed; dev-only postures flagged; unknowns marked **Needs confirmation**. This is a product description, not legal advice — see [Legal](../10-legal/README.md).

Related: [PRD](../01-prd/PRD.md) · [API spec](../06-api-spec/API_SPEC.md) · [Architecture](../04-architecture/ARCHITECTURE.md) · [Runbook](../13-operations/RUNBOOK.md)

---

## 1. Authentication (who you are — middleware only)

- Scheme: `Authorization: Bearer <JWT>`, verified with `jsonwebtoken.verify` (signature + `exp`) against `AXIS_JWT_SECRET`.
- Accepted claims: spec `{ sub, tenantId, roles? }` or legacy `{ userId, tenantId, role? }` (`tenant` aliases `tenantId`). Missing identity claims → `401`.
- Guards: applied to `/search` and `/os/*` **only when the secret is set**. `/health`, `/models`, `/architectures` are always open. Empty secret = fully open mode (local development only).
- The library never sees tokens. The playground only pastes and previews them (decode is local `atob`, never sent anywhere except as the `Authorization` header).

## 2. Authorization (which rows you see — library + data)

- No RBAC: `roles` travel into `AxisContext.roles` but nothing checks them. Do not rely on roles for access decisions.
- Tenant/user mappings (when auth enabled): `tenant → tenant_id (required)`, `user → created_by (required, search field createdBy)` (`DEFAULT_SECURITY`, overridable per app).
- OpenSearch path: term filters merged into `bool.filter` (and kNN filter) for `PurchaseRequisitions`; skipped when `model.security.openSearch.shared` is true (all four vendor models) — any valid token sees the whole catalog.
- Internal SQL path (background/cron only): `resolveSecurityContext` fail-closed (missing `required` value, non-scalar value, or bad session key → `SecurityContextError`, query never runs); values bound as parameters via `set_config(key, value, true)` (`SET LOCAL` semantics) inside one transaction; RLS policies compare `current_setting('app.tenant_id', true)` etc.; pooled connections cannot leak context.
- Cache isolation: library keys hash the normalized query plus the mapping-backed security subset (different tenants → different digests; hits cloned via `structuredClone`). Moot on the request path today (cache disabled) but enforced wherever the library cache is used.
- Fail-closed matrix: no token → `401` (when enabled); missing context → `403`/zero rows; foreign tenant → zero requisition rows; vendor catalog unaffected by design.

## 3. Transport, input, and output hardening (implemented)

- Malformed JSON → `400 InvalidJson` before validation; body cap 256 KB.
- Unknown model/field → `400`/`422`, never executed. Session keys allow-listed by regex; values always bound — injection strings (e.g. `t1'; DROP TABLE …`) cannot escape parameters.
- `500`/`502` bodies redacted (`Query failed. Check server logs for details.`); causes stay server-side. `404` envelope leaks only method+path.
- Graceful shutdown (`SIGINT`/`SIGTERM` → `server.close()` + `axis.close()`) drains the pg pool and closes OS/embedding handles.

## 4. Dev-only postures (must change before any shared rollout)

| Posture | Current | Required for pilot |
|---|---|---|
| CORS `*` | Any origin can call the API. | Restrict to known origins. |
| Optional auth | Empty secret opens reads. | Secret mandatory outside local dev; block startup otherwise. |
| Open cluster assumptions | Docs cite an open OpenSearch (no credentials). | Credentials/TLS per environment; verify `SSL_REJECT_UNAUTHORIZED`. |
| Verbose debug artifacts | `src/reference/indexed-docs.txt` carries tenant/user data; e2e console dumps. | Gitignore pipeline logs; scrub vectors/PII; treat the snapshot as sensitive. |
| Sample docs | `/os/docs` exposes contact PII (names, numbers, emails) to any valid token. | Confirm who may call it; consider restricting or redacting in pilot. |

## 5. Privacy and data handling

- Personal data in the product: `created_by` (email-like), vendor contact name/number/email, tenant/user IDs, JWT claims in transit, vectors derived from department/company/contact text.
- No retention, archival, erasure, export, or DPA evidence — **Needs confirmation** (see [Privacy policy](../10-legal/PRIVACY_POLICY.md), [Terms](../10-legal/TERMS_OF_USE.md)).
- Proposed until confirmed: keep demo PII out of shared environments; minimise `/os/docs` exposure; log without raw PII/vectors; define retention + erasure owners in the pilot (see [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md)).
- No consent, cookie, or tracking logic exists in the playground beyond `localStorage` (`axis.baseUrl`, `axis.token`, `axis.theme`).

## 6. Secrets and configuration

Required secrets: `AXIS_JWT_SECRET` (signing key shared with the token issuer); optional `OPENSEARCH_USERNAME/PASSWORD`, `EMBEDDING_API_KEY`. Connection strings (`DATABASE_URL`, `OPENSEARCH_URL`, `EMBEDDING_URL`) are sensitive. Never commit `.env`; never log tokens or secrets; rotate the JWT secret with coordinated re-issuance (old tokens die at `exp`).

## 7. Residual risks and backlog

Bucket-truncation under-counts; numeric-split consumer breaks; `assignedCount` `502` without the stub; hidden execution causes without correlation IDs; dead planner policy; stale-`tgz` deployments; no scheduler (stale index); no rate limiting/versioning. Owners and order in [Project plan](../07-project-plan/PROJECT_PLAN.md).
