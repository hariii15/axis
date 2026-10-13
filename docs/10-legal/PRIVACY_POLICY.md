# Privacy Policy — Axis (Draft — Requires Legal Review)

> **Draft only. Needs confirmation by counsel and the business.** No retention, erasure, DPA, or consent evidence exists in the repository. Do not publish until approved.

## 1. What data the product touches (observed)

| Data | Where | Why |
|---|---|---|
| JWT claims (`sub`/`userId`, `tenantId`/`tenant`, `roles`/`role`) | Request header → middleware verification → `AxisContext { user, tenant, roles }` | Identify the caller and scope rows. |
| Row-ownership fields (`created_by`, `tenant_id`) | PostgreSQL → OpenSearch documents → term filters | Enforce tenant isolation. |
| Vendor contact PII (contact name/number, `email_id`) | PostgreSQL → `vendor_companies` view → OpenSearch → `/os/docs`, search results | The shared catalog's business purpose. |
| Department/company/contact text + derived vectors | Embedding service ↔ OpenSearch `embedding` field | Semantic search. |
| Operational traces (queries, row counts, timings, server logs, debug snapshots such as `src/reference/indexed-docs.txt`) | Server logs, scripts, console dumps | Diagnosis and index verification. |
| Playground `localStorage` (`axis.baseUrl`, `axis.token`, `axis.theme`) | User's browser only | Convenience; never sent except the token as `Authorization`. |

No cookies, analytics beacons, or marketing trackers were found. No payments or Marketing PII exist.

## 2. Lawful basis, purpose limitation, and sharing — Needs confirmation

Confirm: the lawful basis for processing requisition ownership and vendor-contact PII; whether the shared catalog may be shown to every authenticated tenant; any sub-processors (hosting, OpenSearch, embedding provider); cross-border transfer posture; DPA needs.

## 3. Retention and deletion — Needs confirmation

No retention schedule, archival, or erasure workflow is evidenced. The index is a derived copy refreshed by full re-index; deleting a source row does not automatically remove its document until re-indexed. Confirm: retention periods per entity; erasure request handling (source + index + logs + snapshots); log-retention limits; backup handling.

## 4. Security measures (implemented)

JWT signature + expiry checks; fail-closed tenant isolation; parameterized session settings; redacted `500`/`502` bodies; transaction-scoped security state; graceful shutdown. Dev-only gaps (open CORS, optional auth, open-cluster assumptions, PII-bearing debug files) must be closed before any shared rollout — see [Security & privacy](../09-security-privacy/SECURITY_PRIVACY.md).

## 5. Your rights and contact — Needs confirmation

Confirm: how data subjects access, correct, or delete their data; who the controller/processor contacts are; complaint channels; response timelines. Provide contact details before publishing.
