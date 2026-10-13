# DevOps — Axis

How to build, configure, deploy, and release the real application. No CI/CD pipeline or production topology is evidenced — those sections are marked **Needs confirmation**.

Related: [Architecture](../04-architecture/ARCHITECTURE.md) · [Test strategy](../08-test-plan/TEST_STRATEGY.md) · [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md) · [Runbook](../13-operations/RUNBOOK.md)

---

## 1. Components and ports

| Part | Runtime | Default port | Start |
|---|---|---|---|
| `axis` library | TypeScript ESM, `main ./dist/index.js` | — | `npm run build` (`tsc`) → `npm pack` → `axis-1.0.0.tgz`. |
| `axis-middleware` | Express 5 + TypeScript, `type: module` | `3000` | `npm run build && npm start` (prod) or `npm run dev` (`tsx watch src/server.ts`). |
| `axis-playground` | Next.js 16 + React 19 | `3001` | `npm install && npm run dev` (or `build` + `start -p 3001`). |

Prerequisites: Node 20+ (repo cites 18+ LTS minimum; use 20+), PostgreSQL with database `po`, reachable OpenSearch + embedding service for search. TypeScript `NodeNext` (`module` + `moduleResolution`), explicit `.js` extensions in relative imports, or `ERR_REQUIRE_ESM` / unresolvable `axis` imports result.

## 2. Build and install (the tarball workflow — do not skip)

```bash
# after ANY axis/src change (required — stale node_modules/axis is the #1 phantom-error source)
cd axis && npm run build && npm pack
cd ../axis-middleware && npm install "file:../axis/axis-1.0.0.tgz"

# middleware + playground
cd axis-middleware && npm run build && npm start   # :3000
cd ../axis-playground && npm install && npm run dev # :3001
```

Backlog: replace with `npm workspaces` symlink or a watch task (see [Project plan](../07-project-plan/PROJECT_PLAN.md)).

## 3. Configuration (environment variables, no `.env.example` file)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/postgres` (use `…/po` for this product) | PostgreSQL connection (internal SQL path, seeding, indexing source). |
| `PORT` | `3000` | Middleware listen port. |
| `AXIS_JWT_SECRET` | `""` (open mode) | When set, guards `/search` + `/os/*`. Set in every shared environment. |
| `AXIS_DEFAULT_LIMIT` | `100` | Parsed but unused by routes today; library applies `limit ?? 100`. |
| `OPENSEARCH_URL` (+ `OPENSEARCH_USERNAME/PASSWORD/INDEX_PREFIX`, `OPENSEARCH_SSL_REJECT_UNAUTHORIZED` default true) | unset (search `503` until set) | Enables the OpenSearch adapter. |
| `EMBEDDING_URL`, `EMBEDDING_PROVIDER` (`ollama` \| `openai-compatible`, default `ollama`), `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS` (e.g. `384`) | unset | Enables semantic/hybrid search; provider + dimensions must match the index mapping. |
| `CACHE_ENABLED`, `CACHE_TTL_MS` (60000), `VALKEY_URL` | parsed but **ignored** | Cache is hardcoded `enabled: false`; Valkey not needed. |

Example (local authenticated dev):

```ini
DATABASE_URL=postgresql://postgres:<pass>@localhost:5432/po
AXIS_JWT_SECRET=axis-local-secret
OPENSEARCH_URL=http://<host>:9200
EMBEDDING_URL=http://<host>:8000
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSIONS=384
```

Startup log confirms `auth`, `cache: DISABLED`, `search`, `embeddings`, and `architectures A,A2,C (default A2)` — check it on every deploy.

## 4. Database and index provisioning

```bash
psql "$DATABASE_URL" -f axis-middleware/sql/001_requisition_item_stub.sql   # only if assigned-buyer fields needed
psql "$DATABASE_URL" -f axis-middleware/sql/002_vendor_companies_view.sql   # required for Companies
npx tsx scripts/seed-po.ts            # 8 demo requisitions, re-runnable
npx tsx scripts/seed-vendors.ts       # verifies 30/30/30 vendor rows
npx vitest run tests/e2e-searchAndFilter.test.ts  # bulk-indexes OS, asserts end-to-end
```

Index scripts (`index-companies.ts`, `index-a2.ts`, `sync-companies.ts`) delete + recreate indices from canonical `scripts/*.mapping.json`, bulk-index (embed unless `--no-vectors`), and refresh. `sync-companies` is full re-index (no `updated_at` for incremental).

## 5. Deployment and release — Needs confirmation

No Dockerfile, compose file, CI workflow, or production topology was found. Until confirmed: deploy as two Node processes (+ PG/OS/embedding services); keep the tarball workflow in the release checklist; smoke-test with [Runbook](../13-operations/RUNBOOK.md) probes; never ship `AXIS_JWT_SECRET=""` or `Access-Control-Allow-Origin: *` beyond local dev; treat `src/reference/indexed-docs.txt` as sensitive and keep pipeline logs out of git.

Proposed release checklist: build + pack + reinstall → `tsc` + `vitest` green → apply `sql/*` → seed/verify → re-index + refresh → probe `/health` → `/models` → `/architectures` → `/os/indices` → authenticated `/search` per tenant + shared catalog → playground Connect + builder + raw JSON → record index counts and versions.
