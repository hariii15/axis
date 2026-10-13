# ISSUES_AND_IMPROVEMENTS — Flaws, Inconsistencies, and Opinions

Everything below was verified by reading the code (paths cited). Severity marked
`[fix]` (wrong behavior), `[harden]` (works but fragile), `[opinion]` (design advice).

## [fix] 1. Search-only requests die on the SQL path with a misleading error

`POST /query` with `{ search: {...} }` passes validation (validator explicitly allows
search-only), then `compileQuery` (`axis/src/core/compiler/compiler.ts:37-41`) throws
`CompilationError: Query must contain at least one axis or metric.` The user did nothing
wrong — they used the wrong endpoint — but the message never says that. Fix: in the
`/query` handler, detect `input.search !== undefined` and return
`400: "search requests must use POST /search"` (keeps the `/query`=SQL / `/search`=OS
contract explicit instead of silently succeeding in the wrong place).

## [fixed] 2. Multi-axis grouping silently drops every axis after the first

~~`buildDSL` emitted a separate `<name>_terms` agg per axis while the normalizer
read only the first — extra axes were computed cluster-side then discarded.~~
**Fixed:** terms aggs now nest (axis0 → axis1 → metrics, true multi-GROUP BY)
and the normalizer walks the chain recursively; numeric axes aggregate on the
raw field instead of a nonexistent `.keyword`. Verified live with 3-axis
company queries. Remaining: combined canned-filter metrics each scope
independently via per-metric `filter` sub-aggs (fixed alongside, see below).

## [fix] 3. `terms.size` reuses the row `limit`

`terms: { field, size: query.limit }` conflates "rows to return" with "buckets to
compute". `limit: 3` on a grouped agg silently truncates to 3 departments. Fix: separate
`bucketLimit` (default e.g. 1000) from row `limit`/`offset` applied post-normalization.

## [harden] 4. Execution causes are hidden from the operator path

`searchDocuments` chains causes (`ExecutionError("…embedding.", error)`,
`"Search execution failed.", error`), but the middleware maps execution failures to a
bare 502 ("check server logs"). There is no structured pipeline log — only
`src/reference/indexed-docs.txt` (a data snapshot) plus e2e console dumps. Add a
JSON-lines pipeline log per request: raw body → AST → resolved → DSL sent → raw OS
`took/total/aggregations` → normalized rows → status/duration (truncate vectors, cap
rows, gitignore the file — it carries tenant/user data).

## [harden] 5. Number-type split between paths

OS returns native numbers (`{ newCount: 6 }`); PG returns numeric strings
(`{ newCount: "6" }`). Any consumer switching paths (or comparing `/query` vs `/search`
output) breaks. Decide canonically: coerce PG numerics to numbers at the executor
boundary (recommended — JSON-native), and cover it with a cross-path contract test.

## [harden] 6. `hasAssignedBuyer` / `assignedCount` are unusable in this DB

The axis references `upeg.requisition_item`, which doesn't exist in `po` — any query
touching it fails at execution, not at validation. Either create the table, remove the
axis/metric, or mark it `search: false` + validate axis SQL against the live schema at
startup/seed time.

## [harden] 7. Stale-`tgz` workflow

`axis` is consumed via `file:../axis/axis-1.0.0.tgz`: every library change needs
build → pack → reinstall, and forgetting it produces phantom "missing export" errors.
Consider a workspace (`npm workspaces` + `axis: "*"` symlink) or `tsc --watch` + file
watcher so dev can't run stale code.

## [harden] 8. `trackTotalHits` never set; `size` may be undefined pre-default

Without `trackTotalHits`, `total` can be `{ value, relation: "gte" }` on large indices
while `rowCount` reports `value` as exact. Set `track_total_hits: true` for document
queries (or document the approximation). Minor: `body.size` is `undefined` when no
limit is given until `searchDocuments` defaults it to 100 — default it in the compiler
so the DSL is self-contained.

## [opinion] 9. Planner exists but routes don't use it

`DefaultQueryPlanner` encodes the routing policy (search → OpenSearch, else PostgreSQL)
and `axis.plan()` exposes it, yet `app.ts` routes call `query()`/`searchDocuments()`
directly. Either route `/query` through `plan()` (single entry point, policy in one
place) or delete the planner — dead policy code rots and misleads.

## [opinion] 10. Security asymmetry worth a test

SQL path resolves the security context unconditionally when configured (fail-closed);
OS path builds term filters only when a context object is passed
(`axis.ts:208-211`). Today both fail closed in practice (missing context throws first),
but the two branches encode the invariant differently. Add one test per path: valid
token sees own rows, foreign-tenant token sees zero, no token → 401 — and never let the
branches drift.

## [opinion] 11. Docs were the missing feature

Prior to this change there was no accurate README for the dual-path system (the old one
described SQL-only), no data-flow doc, and the `htmls/` folder held stale one-off pages.
Keep `README/WORKFLOW/OPENSEARCH` updated with every pipeline change, or they become
the next stale artifact. Suggested order of work: #1 → #2 → #5 → #4 → #7.
