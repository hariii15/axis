# Terms of Use — Axis (Draft — Requires Legal Review)

> **Draft only. Needs confirmation by counsel and the business.** No licence, SLA, pricing, or warranty terms are evidenced in the repository. Do not publish until approved.

## 1. What this product is

Axis is a governed analytics and search tool: a semantic library, an Express API (`:3000`), and a browser playground (`:3001`). Users send JSON queries — never SQL — and receive rows and counts from an OpenSearch read store derived from PostgreSQL. See [PRD](../01-prd/PRD.md).

## 2. Permitted use

- Query only through the documented API (`GET /health`, `/models`, `/architectures`, `POST /search`, `GET /os/*`) and the playground.
- Use valid JWT credentials where required. You are responsible for keeping tokens confidential.
- Respect tenant boundaries: do not attempt to access other tenants' requisition rows, circumvent filters, or probe removed endpoints.

## 3. Prohibited use

No sending SQL; no attempting injection, privilege escalation, or filter bypass; no scraping sample-document endpoints beyond your authorisation; no reverse-engineering of embeddings to re-identify individuals; no unlawful, infringing, or harmful use; no load-testing shared environments without permission.

## 4. Data and intellectual property — Needs confirmation

No ownership, licence, or IP terms are evidenced. Confirm: who owns indexed data and query outputs; whether vendor-catalog data may be redistributed; embedding-model licence compliance (MiniLM or configured equivalent).

## 5. Availability, support, and changes — Needs confirmation

No SLA, support, deprecation, or versioning policy is evidenced. The API is currently unversioned; removed routes (`/query/*`, `/cache/*`) return `404`. Confirm maintenance windows, change notice, and rollback commitments before any pilot (see [Pilot plan](../12-pilot-rollout/PILOT_PLAN.md)).

## 6. Security responsibilities

The operator must set `AXIS_JWT_SECRET`, restrict CORS, secure OpenSearch/embedding endpoints, and keep secrets out of code and logs. Users must safeguard tokens and report suspected compromise. See [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md).

## 7. Limitation of liability and governing law — Needs confirmation

No limitation, indemnity, warranty, or jurisdiction terms are evidenced. Counsel must supply them.
