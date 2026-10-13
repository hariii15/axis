# Axis Documentation Index

Product documentation for the whole application as it exists: `axis` library (semantic layer) + `axis-middleware` (Express `:3000`) + `axis-playground` (Next.js `:3001`).

> **Clients send JSON DSL, never SQL; HTTP reads hit OpenSearch only.** The repository is the source of truth. Gaps are marked **Needs confirmation**. Implemented behaviour is distinguished from planned work and ideas in every document. Role, status, and terminology usage is consistent across all docs.

- [00 — Business Requirements (BRD)](./00-brd/BRD.md) — vision, problem, users, objectives, scope/non-scope, rules, requirements, pricing (unknown), risks, metrics, decisions.
- [01 — Product Requirements (PRD)](./01-prd/PRD.md) — overview, roles/permissions, every feature and screen with expected behaviour, validation, state, out of scope.
- [02 — User Stories](./02-user-stories/USER_STORIES.md) — epics A–G with IDs, personas, acceptance criteria, priorities, dependencies; planned/idea backlog.
- [03 — UX Flows](./03-ux-flows/UX_FLOWS.md) — journeys per role, navigation map, screen states, edge cases, Mermaid diagrams.
- [04 — Architecture](./04-architecture/ARCHITECTURE.md) — read/write separation, components, request lifecycle, architectures `A`/`A2`/`C`, ownership and isolation.
- [05 — Data Model](./05-data-model/DATA_MODEL.md) — entities, axes/metrics, lifecycles, retention expectations, isolation boundaries.
- [06 — API Spec](./06-api-spec/API_SPEC.md) — observable endpoints, request/response contracts, error codes, worked examples; removed routes marked removed.
- [07 — Project Plan](./07-project-plan/PROJECT_PLAN.md) — maturity, milestones, work breakdown, dependencies, unknowns.
- [08 — Test Strategy](./08-test-plan/TEST_STRATEGY.md) — levels, entry/exit, data, environments, gaps from `ISSUES_AND_IMPROVEMENTS.md`.
- [09 — Security & Privacy](./09-security-privacy/SECURITY_PRIVACY.md) — auth, isolation, hardening, dev-only postures, privacy handling, secrets.
- [10 — Legal](./10-legal/README.md) — [Terms of Use](./10-legal/TERMS_OF_USE.md) · [Privacy Policy](./10-legal/PRIVACY_POLICY.md) (both drafts requiring legal review).
- [11 — DevOps](./11-devops/DEVOPS.md) — build (tarball workflow), configuration, provisioning, release checklist.
- [12 — Pilot Plan](./12-pilot-rollout/PILOT_PLAN.md) — entry criteria, phased rollout, success metrics, rollback.
- [13 — Operations Runbook](./13-operations/RUNBOOK.md) — health probes, routine tasks, incident triage, escalation.

Repository companions (code-level detail): `axis/README.md`, `axis-middleware/README.md`, `REQUIREMENTS.md`, `AXIS_ARCHITECTURE.md`, `AXIS_WORKFLOW.md`, `OPENSEARCH.md`, `Auth-document.md`, `ISSUES_AND_IMPROVEMENTS.md`, `sql/*.sql`, `scripts/*`.
