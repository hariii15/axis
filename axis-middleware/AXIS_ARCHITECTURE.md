# AXIS — System Architecture

## Purpose

Axis is the semantic and data-access layer used by the middleware. The middleware owns HTTP concerns and authentication; Axis owns query interpretation, model definitions, caching, SQL compilation for background synchronization, OpenSearch search, embedding integration, and result normalization.

The architecture deliberately separates **write/indexing responsibilities** from **read/search responsibilities**.

## Architecture

![System flow: middleware to axis library to OpenSearch and embeddings](htmls/workflow.png)

*Source: [`htmls/workflow.drawio`](htmls/workflow.drawio) — edit in diagrams.net, then re-export `workflow.png`.*

## Component responsibilities

### Frontend / Client

Sends business queries and receives normalized responses. It does not need to know whether the result came from OpenSearch, cache, or S3.

### Axis Middleware

The middleware is the HTTP entry point. It handles routing, request validation at the API boundary, authentication, and creation of the request context.

It should not contain OpenSearch query construction, embedding logic, SQL generation, or search-specific business rules.

### Axis Library

Axis is the central semantic layer.

It understands the registered models and translates a logical request into the appropriate backend operation. It contains both the existing SQL/query pipeline and the new OpenSearch pipeline.

The important architectural point is that **OpenSearch is not a separate application layer outside Axis**. OpenSearch access is implemented through Axis components and configuration.

### Query Planner

The planner decides which execution path is required after the request has been validated and resolved.

For normal dashboard queries, the planner can direct the request toward OpenSearch. Semantic search additionally uses the embedding provider to turn the user's search text into a vector before OpenSearch performs vector similarity search.

The SQL compiler remains available for background synchronization and other operations that genuinely require PostgreSQL.

### Cache

Caching remains an independent performance layer. It is not replaced by OpenSearch.

A cache hit can return the result before the backend query is executed. A cache miss continues through the selected execution path.

### OpenSearch Compiler and Adapter

The OpenSearch compiler converts the resolved logical query into an OpenSearch request.

The adapter is responsible for communication with the configured OpenSearch deployment. This keeps OpenSearch-specific transport details out of the rest of Axis.

OpenSearch supports the read-side workloads that need fast document retrieval, filtering, aggregations, and semantic/vector search.

### Embedding Provider

The embedding provider converts text into vectors.

Axis does not need an LLM to perform semantic search. The embedding service is a separate runtime component and can be backed by Hugging Face, a local model, or another configured provider.

For semantic search:

`user text → embedding provider → vector → OpenSearch vector search`

### PostgreSQL

PostgreSQL remains the source of truth for transactional application data.

The normal frontend search path does not need to query PostgreSQL when the required searchable representation already exists in OpenSearch.

PostgreSQL is still important for background synchronization because Axis needs to discover changed records and update the search representation.

### Cron / Background Synchronization

The cron process periodically checks the source database for new or changed records.

Its responsibility is synchronization, not serving user requests.

The high-level process is:

`PostgreSQL → changed records → Axis SQL/query pipeline → document preparation → embedding when required → OpenSearch`

This keeps the search index current without putting synchronization work on the user's request path.

### S3

S3 stores static or precomputed aggregate data that does not need to be reconstructed for every request.

When a request can be satisfied by a static aggregate, the middleware/Axis integration can read the prepared data from S3 rather than executing a live database aggregation.

## Read and write separation

There are two fundamentally different paths.

### User read path

`Frontend → Middleware → Axis → Query Planner → Cache / OpenSearch / Embedding → Response`

This path is optimized for low latency.

### Background synchronization path

`Cron → Axis SQL pipeline → PostgreSQL → Document preparation → Embedding → OpenSearch`

This path keeps OpenSearch synchronized with the source data.

The SQL compiler therefore remains part of Axis, but it is not part of the ordinary OpenSearch read path.

## Data ownership

| Component | Role |
|---|---|
| PostgreSQL | Transactional source of truth |
| OpenSearch | Search/read-optimized document store |
| Embedding service | Text → vector conversion |
| S3 | Static/precomputed aggregate storage |
| Valkey/Memory cache | Repeated query result acceleration |
| Axis | Semantic/query layer and coordination |
| Middleware | HTTP, authentication, and application wiring |

## Key architectural decisions

1. **Axis owns backend query translation.** Middleware does not build OpenSearch or SQL queries.
2. **OpenSearch is integrated into Axis.** It is an infrastructure dependency behind Axis adapters/configuration, not a second semantic layer.
3. **SQL remains in Axis.** It is primarily used by background synchronization and source-data operations.
4. **Semantic search does not require an LLM.** An embedding model is sufficient to produce vectors for similarity search.
5. **Embedding generation is outside the request process where possible.** Documents can be embedded during synchronization so normal searches only embed the user's query.
6. **OpenSearch is the fast search/read representation.** PostgreSQL remains authoritative.
7. **S3 is for static/precomputed data.** It should not become another general-purpose transactional database.
8. **Caching remains independent.** OpenSearch does not replace the existing cache layer.
