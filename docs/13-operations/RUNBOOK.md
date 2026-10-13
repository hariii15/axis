# Runbook — Axis Operations

Day-to-day operation of the implemented product: middleware `:3000`, playground `:3001`, PostgreSQL `po`, OpenSearch, embedding service. Plain language for operators.

Related: [API spec](../06-api-spec/API_SPEC.md) · [DevOps](../11-devops/DEVOPS.md) · [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md) · [Data model](../05-data-model/DATA_MODEL.md)

---

## 1. Service inventory

| Signal | Check | Healthy when |
|---|---|---|
| Middleware up | `GET /health` → `{ ok: true }` | `200`. |
| Models wired | `GET /models` lists 5 models with axes/metrics. | Non-empty `data[]`. |
| Architectures | `GET /architectures`, `meta.default "A2"`. | `A`/`A2` present; `C` stub acknowledged. |
| Search backend | `GET /os/indices` (auth when enabled). | Per-model `docs`, no `error`; `503` means `OPENSEARCH_URL` unset. |
| Sample docs | `GET /os/docs/:model?limit=5` (auth). | `rows` with truncated vectors; `422` means unknown model. |
| Query path | Authenticated `POST /search` per tenant + shared catalog. | Tenant-001 sees its rows, foreign sees zero requisitions, catalog full. |
| Startup log | `auth`, `cache: DISABLED`, `search`, `embeddings`, architectures. | Matches environment intent (secret set outside dev). |

## 2. Routine tasks

**Rebuild after a library change (always):**

```bash
cd axis && npm run build && npm pack
cd ../axis-middleware && npm install "file:../axis/axis-1.0.0.tgz"
```

**Provision / reseed / re-index:**

```bash
psql "$DATABASE_URL" -f sql/002_vendor_companies_view.sql
# + sql/001_requisition_item_stub.sql only if assigned-buyer fields are used
npx tsx scripts/seed-po.ts        # re-runnable; prints per-tenant counts
npx tsx scripts/seed-vendors.ts   # read-only verify 30/30/30
npx tsx scripts/index-a2.ts       # recreate companyinfo/contactinfo/financialinfo + index + refresh
npx tsx scripts/index-companies.ts
npx tsx scripts/sync-companies.ts [--force] [--no-vectors] [--limit N]
npx tsx scripts/check-postgres.ts scripts/check-opensearch.ts
npx tsx scripts/check-structured-search.ts   # needs OS
npx tsx scripts/check-semantic-e2e.ts        # needs OS + embeddings
```

`sync-companies` is full re-index (no `updated_at`); schedule a manual cadence with an owner until a scheduler exists.

**Tokens:** mint JWTs with `sub` (or `userId`) + `tenantId` (or `tenant`) from the external issuer using the deployed `AXIS_JWT_SECRET`; confirm expiry; paste into the playground Auth card to verify decode + headers before sharing query examples.

**Shutdown/restart:** `SIGINT`/`SIGTERM` → `server.close()` + `axis.close()` (drains pg pool, closes OS/embedding handles). Never `kill -9` except as a last resort; confirm the process exits instead of hanging (missing `axis.close()` is the known hang cause).

## 3. Incident triage (symptom → cause → action)

| Symptom | Likely cause | Action |
|---|---|---|
| `GET /health` down | Process crashed / wrong port. | Check process + `PORT`; read startup log; restart via DevOps steps. |
| `GET /models` empty | Models not registered. | Verify `src/models/*` + registry wiring; rebuild + restart. |
| `404` on `/query/*` or `/cache/*` | Removed routes (by design). | Use `POST /search`; do not "fix" by re-adding. |
| `401` on `/search`, `/os/*` | Missing/malformed/expired/wrong-secret token; or secret changed. | Re-issue token; confirm `AXIS_JWT_SECRET` matches issuer; check `exp`. |
| `403 SecurityContextError` | Required tenant/user missing or non-scalar. | Fix claims/mappings; never bypass with empty context. |
| `400 ValidationError` (+ `issues`) | Bad shape/operator/value. | Correct payload per [API spec](../06-api-spec/API_SPEC.md); check case-sensitive names. |
| `400 UnknownArchitecture` | Bad `X-Axis-Target`. | Send `A`, `A2`, `C`, or empty (= `A2`). |
| `422` unknown model/field/path | Typo or unrelated cross-model ref. | Copy names from `GET /models`; qualify joined fields as `Model.field`. |
| `501` on arch `C` | S3 reads stubbed (by design). | Retry with `A2`. |
| `502` (redacted) | Embedding down (semantic/hybrid), OS execution failure, or missing `requisition_item` for `assignedCount`. | Read server logs for cause; check embedding service + dimensions (384); apply stub or avoid the metric. |
| `503 SearchNotConfigured` | `OPENSEARCH_URL` unset / adapter missing. | Set URL + restart; verify `/os/indices`. |
| `Cannot find module 'axis'` / missing export | Stale `.tgz`. | Rebuild → pack → reinstall → restart. |
| `ERR_REQUIRE_ESM` | CJS consumer. | Convert to `"type": "module"` + `NodeNext` + `.js` relative imports. |
| `Database configuration requires 'url' or 'host'` | `DATABASE_URL` empty. | Set it; restart. |
| Counts look truncated | `terms.size = limit` conflation. | Raise `limit` for grouped aggs until the bucket-limit fix lands. |
| Numbers as strings vs numbers | Legacy SQL vs OpenSearch type split. | Treat OpenSearch (native numbers) as canonical; do not compare across paths. |
| Process hangs on exit | `axis.close()` skipped. | Add `SIGINT`/`SIGTERM` handlers per `REQUIREMENTS.md`. |

Never paste tokens, secrets, raw PII, or full vectors into tickets. Redacted client errors pair with server-log causes — include a correlation ID once pipeline logging lands.

## 4. Escalation and unknowns

Escalate: suspected cross-tenant data exposure (freeze + audit), embedding-model or mapping changes (re-index required), any `500` without a log cause, and repeated `502` on structured (non-semantic) queries. On-call, SLA, backup/restore, and log-retention owners are **Needs confirmation** — fill them in before pilot.
