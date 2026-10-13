# OPENSEARCH — How This Stack Uses OpenSearch, In Detail

All OpenSearch (OS) logic lives in the `axis` library; the middleware only wires it
(`src/app.ts` → `OpenSearchAdapter`, embedding provider → `new Axis({...})`).
Library files: `src/core/search/` (transport), `src/core/compiler/opensearch/`
(DSL + normalization), `src/core/indexing/` (writes), `src/core/embeddings/` (vectors).

## 1. Connection (`core/search/OpenSearchAdapter.ts`)

- Wraps `@opensearch-project/opensearch` `Client({ node, auth?, ssl? })` from
  `OpenSearchConfig { url, username?, password?, indexPrefix?, ssl? }`.
- `indexPrefix` is prepended to every index name (`getFullIndexName`) — one knob for
  env separation (dev/staging/prod on one cluster).
- Accepts an injected `client` (tests inject fakes; middleware builds from URL).
- Interface `SearchAdapter { search, index, deleteIndex, healthCheck, close }` keeps the
  engine transport-agnostic.

## 2. Request shape (`core/search/types.ts`)

```ts
SearchParams { index, query: SearchQuery, size?, from?, sort?, trackTotalHits?, aggs? }
SearchQuery  { bool?, match?, matchAll?, knn? }            // bool/match/knn mirror OS DSL
BoolQuery    { must?, should?, filter?, mustNot?, minimum_should_match? }
KNNQuery     { field, vector, k, numCandidates?, filter? } // filter = tenant isolation in-kNN
SearchResult { hits[], total, took, timedOut, aggregations? }
```

The adapter converts this typed form to the raw OS body (`convertQuery`), sends it,
and maps the raw response (`took`, `timed_out`, `hits.total`, `hits.hits`,
`aggregations`) back to `SearchResult`.

## 3. DSL compiler (`core/compiler/opensearch/compiler.ts`)

`compileToOpenSearch(resolved, { securityFilters?, queryVector? }) → { index, body }`.
Index comes from `model.search.index` (fallback: model name). Two builders:

**`buildDSL`** (filter/agg queries, no `search` node):
- `query`: `bool` combining `filter` (structured filters + security terms) and `must`.
- `size`/`from` from `limit`/`offset`; `sort` from `orderBy`.
- `_source`: only the requested axes' search fields (narrow payloads).
- `aggs`: one metric agg per requested metric (`value_count`/`sum`/`avg`/`min`/`max`/
  `cardinality` per metric type). With axes, each axis additionally gets a
  `<name>_terms` agg (`terms: { field: "<field>.keyword", size: limit }`) nesting the
  metric aggs — the GROUP BY equivalent.

**`buildSearchDSL`** (with `search` node):
- `fulltext`: `match` per searchable field (`model.search.searchable`, default axes),
  `minimum_should_match` to narrow multi-term text.
- `semantic`: `knn: { <embeddingField>: { vector: queryVector, k } }` where the vector
  was produced server-side by the embedding provider (the compiler never calls it).
- `hybrid`: both clauses combined.
- Security term filters are merged into `bool.filter` (and into the kNN `filter` where
  applicable) so tenant isolation applies before scoring/aggregation.

Field mapping: text axes filter/sort/group on the **`.keyword` subfield** (exact match,
sorting, terms aggs); numeric PG columns are coerced to real numbers by the indexer so
range filters and `sum`/`avg` work. `debugCompileToOpenSearch(input, model)` returns
`{ query, ast, resolved, dsl }` for inspection (e2e tests log input → DSL → rows).

## 4. Execution policy (`core/axis.ts: searchDocuments`)

- Metric queries (aggs present) are sent with **`size: 0`** — aggregations are computed
  cluster-side, zero hits transferred. Document queries send the real `size` (default 100).
- `sort` forwarded only when the compiled body contains it.
- Transport failure → `ExecutionError("Search execution failed.", cause)`.

## 5. Response normalization (`core/compiler/opensearch/normalize.ts`)

`normalizeAggregationRows(axes, metrics, aggregations)` → SQL-shaped rows:
- metric-only → single row (`{ newCount: 6 }`), like `SELECT COUNT(*)` without GROUP BY.
- axes + metrics → one row per terms bucket (`{ department: "Eng", newCount: 2 }`).
- `metricValue()` unwraps `{ value }` from `value_count`/`sum`/`avg`/`min`/`max`/`cardinality`.
- Documents bypass this: `rows = hits.map({ ..._source, _id, _score? })`.

## 6. Indexing (`core/indexing/`)

`ModelIndexer` (`axis.index()`): SELECT source rows → `transformer` maps columns to index
fields per `model.search` (`searchable`, `embeddingInput`, `embeddingField`) → embed
text → bulk index. PG numerics → JSON numbers; `created_by`/`tenant_id` travel into the
doc so OS-side term filters enforce row ownership without PG. Current model indexes
`department` text + `embedding` vector into `purchase-requisitions` (the table has no
title/description columns — `department_name` is the only embeddable text, verified
against the live schema).

## 7. Embeddings (`core/embeddings/`)

`EmbeddingProvider { embed(text): number[] }`. Two HTTP providers:
`OllamaEmbeddingProvider` (native `/api/embed`) and `OpenAICompatibleEmbeddingProvider`
(`POST /embeddings`); dims from `EMBEDDING_DIMENSIONS` (384, MiniLM-L6-v2 here).
Used in exactly two places: query-time (`searchDocuments` for semantic/hybrid) and
index-time (indexer). No provider → `ExecutionError` telling you to pass
`embeddings.instance`.

## 8. Gotchas (verified)

- OS counts are **native numbers**; the SQL path returns numeric **strings**. Consumers
  must handle both.
- `terms.size` reuses the query `limit` — bucket count and row limit are conflated.
- `trackTotalHits` is unset, so `total` may be `{ value, relation: "gte" }` on big indices.
- `normalizeAggregationRows` reads only the **first** axis's buckets (see issues doc).
- Search-only requests (no axes/metrics) are valid on `/search`; the SQL compiler still
  rejects them — hence the `/query` vs `/search` rule.
