import { CacheManager } from "./cache/cache-manager.js";
import { compileToOpenSearch } from "./compiler/opensearch/index.js";
import type { Cache } from "./cache/types.js";
import type { DatabaseConfig } from "./database/types.js";
import type { QueryResult } from "./executor/types.js";
import { ModelRegistry } from "../model/registry.js";
import { RelationshipRegistry } from "../model/relationship.js";
import type { SearchConfig, SearchAdapter } from "./search/types.js";
import type { EmbeddingProvider, EmbeddingsConfig } from "./embeddings/types.js";
import type { Indexer, IndexOptions, IndexResult } from "./indexing/types.js";
import type { QueryOptions } from "./query-engine/types.js";
import type { StorageConfig } from "./storage/types.js";
import type { ExecutionPlan, PlanContext, PlanInput, PlannerConfig, QueryPlanner } from "./planner/types.js";
import type { IndexingConfig } from "./indexing/types.js";
/**
 * Cache configuration (Phase 11).
 *
 * ```ts
 * new Axis({
 *   database: { url: process.env.DATABASE_URL },
 *   cache: {
 *     enabled: true,     // master switch (default true when `cache` is given)
 *     ttl: 60_000,       // default TTL in ms (default 60_000)
 *     backend: new ValkeyCache({ url: process.env.VALKEY_URL }),
 *   },
 * });
 * ```
 *
 * Omit `cache` entirely for zero behavior change (no caching).
 * Pass `manager` to take full control (custom backend, prefix, TTL).
 */
export interface CacheConfig {
    enabled?: boolean;
    /** Default TTL in **milliseconds**. @default 60_000 */
    ttl?: number;
    /**
     * Storage backend (`MemoryCache` by default, `ValkeyCache` for
     * production). Ignored when `manager` is given.
     */
    backend?: Cache;
    /** Fully-built manager — overrides `backend`/`ttl` construction. */
    manager?: CacheManager;
}
export interface AxisConfig {
    database: DatabaseConfig;
    registry?: ModelRegistry;
    /**
     * Logical join topology between models (generic — concrete
     * relationships are registered by the middleware/application).
     * When provided, `searchDocuments()` resolves dotted refs
     * (`ContactInfo.email`) via the multi-model path.
     */
    relationships?: RelationshipRegistry;
    /**
     * Logical architecture → datasource mapping (generic — concrete
     * architectures like "A"/"A2"/"C" are defined by the
     * middleware/application). Informational for now; per-request
     * routing arrives via `PlanContext.datasource`.
     */
    architectures?: Record<string, import("./planner/types.js").DataSourceName>;
    cache?: CacheConfig;
    security?: import("./security/types.js").AxisSecurityConfig;
    search?: SearchConfig;
    embeddings?: EmbeddingsConfig;
    storage?: StorageConfig;
    planner?: PlannerConfig;
    indexing?: IndexingConfig;
    searchAdapter?: SearchAdapter;
}
export declare class Axis {
    private readonly database;
    private readonly engine;
    private readonly cacheManager;
    private readonly searchAdapter;
    private readonly openSearchCompiler;
    private readonly queryPlanner;
    private readonly embeddingProvider;
    private readonly modelIndexer;
    private readonly relationshipRegistry;
    private readonly architectures;
    private readonly searchConfig;
    private readonly embeddingsConfig;
    private readonly storageConfig;
    private readonly plannerConfig;
    private readonly indexingConfig;
    constructor(config: AxisConfig);
    /**
     * Plan where a semantic request should execute (Phase 6).
     * Deterministic and rule-based — no query execution happens here.
     * The existing `query()` path still targets PostgreSQL; the planner
     * output will drive routing in a later phase.
     */
    plan(input: PlanInput, context?: PlanContext): Promise<ExecutionPlan>;
    query<T = Record<string, unknown>>(input: unknown, options?: QueryOptions): Promise<QueryResult<T>>;
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
    searchDocuments<T = Record<string, unknown>>(input: unknown, options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * The active cache manager, or `undefined` when caching
     * was not configured. Use it for stats and invalidation:
     *
     * ```ts
     * await axis.cache?.stats();
     * await axis.invalidateModel("PurchaseRequisitions");
     * ```
     */
    get cache(): CacheManager | undefined;
    /**
     * Invalidate every cached query for one model.
     * No-op (returns 0) when caching is not configured.
     */
    invalidateModel(model: string): Promise<number>;
    /**
     * The relationship registry (generic join topology), or `undefined`
     * when the middleware did not provide one. Single-model queries
     * work without it; cross-model refs require it.
     */
    get relationships(): RelationshipRegistry | undefined;
    /**
     * The logical architecture → datasource mapping supplied by the
     * middleware, or `undefined` when not configured.
     */
    get architectureMap(): Record<string, import("./planner/types.js").DataSourceName> | undefined;
    /**
     * The search adapter, or `undefined` when not configured.
     * Built and injected by the middleware/application.
     */
    get search(): SearchAdapter | undefined;
    /**
     * The OpenSearch compiler, or `undefined` when not configured.
     * Used to compile a ResolvedQuery to OpenSearch DSL.
     */
    get openSearch(): typeof compileToOpenSearch | undefined;
    /**
     * The active query planner (Phase 6). Always present — defaults to
     * `DefaultQueryPlanner` when no custom planner is configured.
     */
    get planner(): QueryPlanner;
    /**
     * The embedding provider (Phase 7), or `undefined` when not configured.
     * Built and injected by the middleware/application.
     */
    get embeddings(): EmbeddingProvider | undefined;
    /**
     * The model indexer (Phase 8), or `undefined` when no search
     * adapter is configured. Used by cron workers:
     *
     * ```ts
     * await axis.index("PurchaseRequisitions", { since: lastSync });
     * ```
     */
    get indexer(): Indexer | undefined;
    /**
     * Index a model's rows into OpenSearch.
     * Throws when indexing is not configured (no search adapter).
     */
    index(model: string, options?: IndexOptions): Promise<IndexResult>;
    close(): Promise<void>;
}
//# sourceMappingURL=axis.d.ts.map