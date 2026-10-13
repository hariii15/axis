import { Database } from "./database/database.js";
import { AxisQueryEngine } from "./query-engine/query-engine.js";
import { CacheManager } from "./cache/cache-manager.js";
import { compileToOpenSearch, normalizeAggregationRows, } from "./compiler/opensearch/index.js";
import { DefaultQueryPlanner } from "./planner/planner.js";
import { ModelRegistry } from "../model/registry.js";
import { RelationshipRegistry } from "../model/relationship.js";
import { ModelIndexer } from "./indexing/indexer.js";
import { parseAxisQuery } from "./query/validator.js";
import { buildQueryAST } from "../ast/builder.js";
import { resolveQuery } from "./resolver/resolver.js";
import { resolveSecurityContext } from "./security/resolver.js";
import { buildOpenSearchSecurityFilters } from "./security/opensearch.js";
import { searchJoinedDocuments } from "./search/joined-search.js";
import { ExecutionError } from "./executor/errors.js";
export class Axis {
    database;
    engine;
    cacheManager;
    searchAdapter;
    openSearchCompiler;
    queryPlanner;
    embeddingProvider;
    modelIndexer;
    relationshipRegistry;
    architectures;
    // Phase 1: Store config for future extensions (not used yet)
    searchConfig;
    embeddingsConfig;
    storageConfig;
    plannerConfig;
    indexingConfig;
    constructor(config) {
        this.database = new Database(config.database);
        this.cacheManager = createCacheManager(config.cache);
        this.searchAdapter = config.searchAdapter;
        this.openSearchCompiler = compileToOpenSearch;
        this.searchConfig = config.search;
        this.embeddingsConfig = config.embeddings;
        this.storageConfig = config.storage;
        this.plannerConfig = config.planner;
        this.indexingConfig = config.indexing;
        this.queryPlanner = createQueryPlanner(config.planner);
        this.embeddingProvider = config.embeddings?.instance;
        this.relationshipRegistry = config.relationships;
        this.architectures = config.architectures;
        this.modelIndexer = createModelIndexer(this.database, config.registry, this.searchAdapter, this.embeddingProvider, config.indexing);
        this.engine = new AxisQueryEngine(this.database, {
            ...(config.registry !== undefined ? { registry: config.registry } : {}),
            ...(this.cacheManager !== undefined ? { cache: this.cacheManager } : {}),
            ...(config.security !== undefined ? { security: config.security } : {}),
        });
    }
    /**
     * Plan where a semantic request should execute (Phase 6).
     * Deterministic and rule-based — no query execution happens here.
     * The existing `query()` path still targets PostgreSQL; the planner
     * output will drive routing in a later phase.
     */
    async plan(input, context = {}) {
        return this.queryPlanner.plan(input, context);
    }
    async query(input, options = {}) {
        return this.engine.query(input, options);
    }
    /**
     * Execute a search request against OpenSearch (Phase 9).
     *
     * Validate → AST → resolve → embed (semantic/hybrid) →
     * compile to DSL → search adapter → normalized rows.
     *
     * Rows are the indexed `_source` documents plus `_id`
     * (and `_score` when scored). Results are cached with the
     * same security-aware keys as `query()`.
     */
    async searchDocuments(input, options = {}) {
        const query = parseAxisQuery(input);
        const ast = buildQueryAST(query);
        // Multi-model path: bare refs resolve against the root model,
        // dotted refs (`ContactInfo.email`) resolve via the registry and
        // join steps via the relationship registry (both middleware-owned).
        // Falls back to identical behavior for single-model queries.
        const resolved = resolveQuery(ast, {
            registry: this.engine.getRegistry(),
            ...(this.relationshipRegistry !== undefined
                ? { relationships: this.relationshipRegistry }
                : {}),
        });
        const securityConfig = this.engine.getSecurityConfig();
        const resolvedSecurity = securityConfig === undefined
            ? undefined
            : resolveSecurityContext(options.context ?? {}, securityConfig);
        const securityCacheKey = resolvedSecurity?.cacheKey;
        const cache = this.engine.getCache();
        if (cache !== undefined) {
            const cached = await cache.get(query, securityCacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }
        const searchType = query.search?.type;
        let queryVector;
        if (searchType === "semantic" || searchType === "hybrid") {
            if (this.embeddingProvider === undefined) {
                throw new ExecutionError(`Search type "${searchType}" requires an embedding provider: pass embeddings.instance to Axis.`);
            }
            const text = query.search?.text ?? "";
            try {
                queryVector = await this.embeddingProvider.embed(text);
            }
            catch (error) {
                throw new ExecutionError("Failed to generate the search query embedding.", error);
            }
        }
        // Shared-catalog models (no tenant column) skip engine term filters.
        // Authentication is still enforced above; only the per-tenant
        // scoping is lifted for these models.
        const sharedCatalog = resolved.model.security?.openSearch?.shared === true;
        const securityFilters = securityConfig === undefined ||
            options.context === undefined ||
            sharedCatalog
            ? []
            : buildOpenSearchSecurityFilters(options.context, securityConfig);
        // Multi-model queries (joins across indices) cannot be answered by
        // the single-index compiler — they execute via generic in-memory
        // joining over per-model OpenSearch fetches. Same cache behavior,
        // same security-aware keys; single-model queries are untouched below.
        if (resolved.joins.length > 0) {
            if (this.searchAdapter === undefined) {
                throw new ExecutionError("Search is not configured: pass a searchAdapter to Axis.");
            }
            const { rows, rowCount } = await searchJoinedDocuments(resolved, this.searchAdapter, {
                securityFilters,
                ...(queryVector !== undefined ? { queryVector } : {}),
            });
            const output = { rows: rows, rowCount };
            if (cache !== undefined) {
                await cache.set(query, output, query.cacheTtl, securityCacheKey);
            }
            return output;
        }
        const compiled = compileToOpenSearch(resolved, {
            securityFilters,
            ...(queryVector !== undefined ? { queryVector } : {}),
        });
        if (this.searchAdapter === undefined) {
            throw new ExecutionError("Search is not configured: pass a searchAdapter to Axis.");
        }
        const body = compiled.body;
        const sort = Array.isArray(body.sort)
            ? body.sort
            : undefined;
        // Projection: the compiler lists requested axes in `_source`.
        // Without forwarding it, OpenSearch returns full documents.
        const _source = Array.isArray(body._source) && body._source.length > 0
            ? body._source
            : undefined;
        // Metric queries are answered from aggregations (no hits needed);
        // document queries are answered from hits (no aggs requested).
        const rawAggs = body.aggs;
        const aggs = typeof rawAggs === "object" &&
            rawAggs !== null &&
            Object.keys(rawAggs).length > 0
            ? rawAggs
            : undefined;
        let result;
        try {
            result = await this.searchAdapter.search({
                index: compiled.index,
                query: body.query,
                size: aggs !== undefined
                    ? 0
                    : (typeof body.size === "number" ? body.size : query.limit ?? 100),
                from: typeof body.from === "number" ? body.from : query.offset ?? 0,
                ...(sort !== undefined ? { sort } : {}),
                ...(aggs !== undefined ? { aggs } : {}),
                ...(_source !== undefined ? { _source } : {}),
            });
        }
        catch (error) {
            if (error instanceof ExecutionError)
                throw error;
            throw new ExecutionError("Search execution failed.", error);
        }
        let rows;
        let rowCount;
        if (aggs !== undefined) {
            rows = normalizeAggregationRows(resolved.axes.map((axis) => axis.name), resolved.metrics.map((metric) => metric.name), result.aggregations ?? {});
            rowCount = rows.length;
        }
        else {
            rows = result.hits.map((hit) => ({
                ...hit._source,
                _id: hit._id,
                ...(hit._score !== undefined ? { _score: hit._score } : {}),
            }));
            rowCount =
                typeof result.total === "number" ? result.total : result.total.value;
        }
        const output = { rows, rowCount };
        if (cache !== undefined) {
            await cache.set(query, output, query.cacheTtl, securityCacheKey);
        }
        return output;
    }
    /**
     * The active cache manager, or `undefined` when caching
     * was not configured. Use it for stats and invalidation:
     *
     * ```ts
     * await axis.cache?.stats();
     * await axis.invalidateModel("PurchaseRequisitions");
     * ```
     */
    get cache() {
        return this.cacheManager;
    }
    /**
     * Invalidate every cached query for one model.
     * No-op (returns 0) when caching is not configured.
     */
    async invalidateModel(model) {
        return this.cacheManager?.invalidateModel(model) ?? 0;
    }
    /**
     * The relationship registry (generic join topology), or `undefined`
     * when the middleware did not provide one. Single-model queries
     * work without it; cross-model refs require it.
     */
    get relationships() {
        return this.relationshipRegistry;
    }
    /**
     * The logical architecture → datasource mapping supplied by the
     * middleware, or `undefined` when not configured.
     */
    get architectureMap() {
        return this.architectures;
    }
    /**
     * The search adapter, or `undefined` when not configured.
     * Built and injected by the middleware/application.
     */
    get search() {
        return this.searchAdapter;
    }
    /**
     * The OpenSearch compiler, or `undefined` when not configured.
     * Used to compile a ResolvedQuery to OpenSearch DSL.
     */
    get openSearch() {
        return this.searchAdapter ? this.openSearchCompiler : undefined;
    }
    /**
     * The active query planner (Phase 6). Always present — defaults to
     * `DefaultQueryPlanner` when no custom planner is configured.
     */
    get planner() {
        return this.queryPlanner;
    }
    /**
     * The embedding provider (Phase 7), or `undefined` when not configured.
     * Built and injected by the middleware/application.
     */
    get embeddings() {
        return this.embeddingProvider;
    }
    /**
     * The model indexer (Phase 8), or `undefined` when no search
     * adapter is configured. Used by cron workers:
     *
     * ```ts
     * await axis.index("PurchaseRequisitions", { since: lastSync });
     * ```
     */
    get indexer() {
        return this.modelIndexer;
    }
    /**
     * Index a model's rows into OpenSearch.
     * Throws when indexing is not configured (no search adapter).
     */
    async index(model, options = {}) {
        if (this.modelIndexer === undefined) {
            throw new Error("Indexing is not configured: pass a searchAdapter to Axis.");
        }
        return this.modelIndexer.index(model, options);
    }
    async close() {
        await this.database.close();
        await this.cacheManager?.close();
        await this.searchAdapter?.close();
        await this.embeddingProvider?.close();
    }
}
function createQueryPlanner(config) {
    if (config === undefined) {
        return new DefaultQueryPlanner();
    }
    const planner = config.planner;
    if (planner !== undefined &&
        typeof planner !== "string" &&
        typeof planner.plan === "function") {
        return planner;
    }
    return new DefaultQueryPlanner({
        ...(config.rules !== undefined ? { rules: config.rules } : {}),
        ...(config.defaultTarget !== undefined
            ? { defaultTarget: config.defaultTarget }
            : {}),
    });
}
function createModelIndexer(database, registry, searchAdapter, embeddingProvider, config) {
    if (config?.indexer !== undefined) {
        return config.indexer;
    }
    if (searchAdapter === undefined) {
        return undefined;
    }
    return new ModelIndexer({
        database,
        registry: registry ?? new ModelRegistry(),
        search: searchAdapter,
        ...(embeddingProvider !== undefined
            ? { embeddings: embeddingProvider }
            : {}),
        ...(config?.batchSize !== undefined ? { batchSize: config.batchSize } : {}),
        ...(config?.concurrency !== undefined
            ? { concurrency: config.concurrency }
            : {}),
        ...(config?.retryAttempts !== undefined
            ? { retryAttempts: config.retryAttempts }
            : {}),
        ...(config?.retryDelayMs !== undefined
            ? { retryDelayMs: config.retryDelayMs }
            : {}),
    });
}
function createCacheManager(config) {
    if (config === undefined) {
        return undefined;
    }
    if (config.manager !== undefined) {
        return config.manager;
    }
    // NOTE: properties are spread conditionally because
    // `exactOptionalPropertyTypes` forbids passing explicit `undefined`.
    return new CacheManager({
        ...(config.backend !== undefined ? { backend: config.backend } : {}),
        ...(config.ttl !== undefined ? { ttl: config.ttl } : {}),
        ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
    });
}
//# sourceMappingURL=axis.js.map