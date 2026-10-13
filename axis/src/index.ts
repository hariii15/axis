export { Axis } from "./core/axis.js";
export { Database } from "./core/database/database.js";
export { AxisQueryEngine } from "./core/query-engine/query-engine.js";
export { MemoryCache, createCacheKey, buildCacheKey, CacheManager, DEFAULT_CACHE_TTL_MS, ValkeyCache } from "./core/cache/index.js";
export type { Cache, CacheInfo, MemoryCacheOptions, CacheKeyOptions, CacheManagerOptions, CacheStats, CacheStatsSnapshot, ValkeyCacheOptions, ValkeyClient } from "./core/cache/index.js";
export {
  ModelRegistry,
  defaultModelRegistry,
  registerModel,
  getModel,
  hasModel,
} from "./model/registry.js";
export { defineModel } from "./model/model.js";
export {
  RelationshipRegistry,
  defaultRelationshipRegistry,
} from "./model/relationship.js";
export type {
  Relationship,
  RelationshipType,
} from "./model/relationship.js";
export type {
  DataSource,
  DataScanRequest,
  DataScanResult,
  ModelDocFetcher,
} from "./core/datasource/types.js";
export type { DataSourceName } from "./core/datasource/types.js";

export type {
  AxisConfig,
  CacheConfig,
} from "./core/axis.js";

export type { DatabaseConfig } from "./core/database/types.js";

export type {
  QueryResult,
  QueryExecutor,
} from "./core/executor/types.js";
export { ExecutionError } from "./core/executor/errors.js";

export type { QueryEngine, QueryOptions } from "./core/query-engine/types.js";
export type { AxisQueryEngineOptions } from "./core/query-engine/query-engine.js";
export type { AxisContext } from "./core/context/types.js";
export type {
  AxisSecurityConfig,
  ResolvedSecurityContext,
  SecurityMapping,
} from "./core/security/types.js";
export { SecurityContextError } from "./core/security/errors.js";
export { resolveSecurityContext } from "./core/security/resolver.js";
export { buildOpenSearchSecurityFilters } from "./core/security/opensearch.js";

export type {
  AxisQuery,
  Filter,
  FilterOperator,
  FilterValue,
  OrderBy,
  SearchInput,
  SearchType,
} from "./core/query/types.js";
export {
  validateSearch,
  isSearch,
  parseSearch,
  safeParseSearch,
} from "./core/query/validator.js";

export type {
  ModelDefinition,
  ModelSource,
  AxisDefinition,
  AxisType,
  AxisSearchDefinition,
  MetricDefinition,
  MetricType,
  MetricSearchDefinition,
  ModelSecurity,
  ModelSearchDefinition,
} from "./model/types.js";

export type {
  SearchConfig,
  SearchAdapter,
  SearchParams,
  SearchQuery,
  BoolQuery,
  MatchQuery,
  KNNQuery,
  KNNInput,
  SortOption,
  SearchResult,
  SearchHit,
  IndexParams,
  SearchIndexResult,
  OpenSearchConfig,
} from "./core/search/types.js";

export { OpenSearchAdapter, createOpenSearchAdapter } from "./core/search/index.js";
export {
  compileToOpenSearch,
  searchFieldForAxis,
  searchFieldForMetric,
} from "./core/compiler/opensearch/index.js";
export type { CompileToOpenSearchOptions } from "./core/compiler/opensearch/index.js";
export {
  debugCompileToOpenSearch,
  normalizeAggregationRows,
  metricValue,
} from "./core/compiler/opensearch/index.js";

export type {
  EmbeddingsConfig,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  OpenAIEmbeddingConfig,
  HuggingFaceEmbeddingConfig,
  LocalEmbeddingConfig,
  OllamaEmbeddingConfig,
} from "./core/embeddings/types.js";
export {
  OpenAICompatibleEmbeddingProvider,
  OllamaEmbeddingProvider,
} from "./core/embeddings/index.js";
export type { HttpEmbeddingProviderOptions } from "./core/embeddings/index.js";

export type {
  StorageConfig,
  StorageAdapter,
  StorageObject,
  S3Config,
  StatisticsConfig,
  PrecomputedStatistic,
} from "./core/storage/types.js";

export { ExecutionTarget } from "./core/planner/index.js";
export type {
  ArchitectureName,
  PlannerConfig,
  QueryPlanner,
  PlanInput,
  PlanFilter,
  PlanOrderBy,
  PlanSearch,
  PlanContext,
  ExecutionPlan,
  PlanningRule,
  DefaultPlannerConfig,
} from "./core/planner/types.js";
export {
  DefaultQueryPlanner,
  createDefaultPlanner,
} from "./core/planner/index.js";
export type { DefaultQueryPlannerOptions } from "./core/planner/index.js";

export type {
  IndexingConfig,
  Indexer,
  IndexOptions,
  ReindexOptions,
  IndexResult,
  IndexError,
  IndexStatus,
  DocumentTransformer,
  SearchDocument,
  ChangeDetector,
  ChangeEvent,
  IncrementalIndexerConfig,
} from "./core/indexing/types.js";
export {
  DefaultDocumentTransformer,
  BulkIndexer,
  ModelIndexer,
} from "./core/indexing/index.js";
export type {
  DocumentTransformerOptions,
  BulkIndexerOptions,
  BulkIndexResult,
  ModelIndexerOptions,
} from "./core/indexing/index.js";