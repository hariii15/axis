import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import swaggerUi from "swagger-ui-express";
import {
  Axis,
  CacheManager,
  MemoryCache,
  ModelRegistry,
  ValkeyCache,
  OpenSearchAdapter,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  buildOpenSearchSecurityFilters,
  type AxisQuery,
  type AxisSecurityConfig,
  type Cache,
  type EmbeddingProvider,
  type ModelDefinition,
  type OpenSearchConfig,
  type SearchAdapter,
  type SearchQuery,
} from "axis";

import { SecurityContextError } from "axis";

import {
  AuthError,
  createAuthMiddleware,
  type AuthenticatedRequest,
} from "./auth/auth.js";

import { PurchaseRequisitions } from "./models/purchase-requisitions.js";
import { Companies } from "./models/companies.js";
import { CompanyInfo } from "./models/company-info.js";
import { ContactInfo } from "./models/contact-info.js";
import { FinancialInfo } from "./models/financial-info.js";
import { createA2Relationships } from "./models/relationships.js";
import {
  ARCHITECTURES,
  ARCHITECTURE_DATASOURCE,
  ARCHITECTURE_MODELS,
  DEFAULT_ARCHITECTURE,
  datasourceForArchitecture,
  parseArchitectureHeader,
  type ArchitectureName,
} from "./architectures.js";
import { RelationshipRegistry } from "axis";

/**
 * Cache wiring for the middleware (caching.md §13).
 *
 * DEV DEFAULT: in-process `MemoryCache` — zero infrastructure.
 * Switch to shared Valkey later by setting `valkeyUrl`
 * (env `VALKEY_URL`) — no code change required.
 */
export interface CacheWiringOptions {
  /** Master switch. `false` => Axis gets `enabled: false` (always-miss). @default true */
  cacheEnabled?: boolean;
  /** Default entry TTL in milliseconds. @default 60_000 */
  cacheTtlMs?: number;
  /**
   * When non-empty, a `ValkeyCache` is built against this URL.
   * When empty/unset, a `MemoryCache` is built. @default "" (memory)
   */
  valkeyUrl?: string;
  /**
   * Fully-built manager. Takes precedence over the other three
   * options (custom prefix / backend / TTL). Useful for tests.
   */
  cacheManager?: CacheManager;
  /** Custom backend (takes precedence over the valkeyUrl switch). */
  cacheBackend?: Cache;
}

export interface CreateAppOptions extends CacheWiringOptions {
  databaseUrl?: string;
  /**
   * JWT secret for `Authorization: Bearer <JWT>` verification.
   * When empty/unset, `/query` stays open (no auth, no security
   * context) — backward compatible for local dev and tests.
   * Set it (env `AXIS_JWT_SECRET`) to enforce authentication.
   */
  jwtSecret?: string;
  /**
   * Security mappings registered on the Axis engine. Used only when
   * `jwtSecret` is set. Defaults to required tenant + user mappings.
   */
  security?: AxisSecurityConfig;
  /**
   * OpenSearch URL (env `OPENSEARCH_URL`). When set, an OpenSearchAdapter
   * is created and passed to Axis. When empty/unset, no search adapter is used.
   */
  opensearchUrl?: string;
  /** OpenSearch username (env `OPENSEARCH_USERNAME`). */
  opensearchUsername?: string;
  /** OpenSearch password (env `OPENSEARCH_PASSWORD`). */
  opensearchPassword?: string;
  /** Index prefix for all indices (env `OPENSEARCH_INDEX_PREFIX`). */
  opensearchIndexPrefix?: string;
  /** Whether to reject unauthorized SSL certs (env `OPENSEARCH_SSL_REJECT_UNAUTHORIZED`, default true). */
  opensearchSslRejectUnauthorized?: boolean;
  /** Pre-built search adapter (takes precedence over URL wiring). Useful for tests. */
  searchAdapter?: import("axis").SearchAdapter;
  /**
   * Embedding service URL (env `EMBEDDING_URL`). When set with
   * `embeddingModel`, an embedding provider is built and passed to Axis.
   */
  embeddingUrl?: string;
  /** "ollama" (native /api/embed) or "openai-compatible". @default "ollama" */
  embeddingProvider?: string;
  /** Model name in the embedding container (env `EMBEDDING_MODEL`). */
  embeddingModel?: string;
  /** API key for OpenAI-compatible endpoints (env `EMBEDDING_API_KEY`). */
  embeddingApiKey?: string;
  /** Known vector dimensions (env `EMBEDDING_DIMENSIONS`). */
  embeddingDimensions?: number;
  /** Pre-built provider (takes precedence over URL wiring). Useful for tests. */
  embeddingProviderInstance?: EmbeddingProvider;
}

/** Default RLS-backed mappings: context keys -> PostgreSQL session keys. */
export const DEFAULT_SECURITY: AxisSecurityConfig = {
  mappings: {
    tenant: {
      contextKey: "tenant",
      column: "tenant_id",
      sessionKey: "app.tenant_id",
      required: true,
    },
    user: {
      contextKey: "user",
      column: "created_by",
      sessionKey: "app.user_id",
      required: true,
      // Indexed docs use semantic axis names (createdBy), not DB
      // columns — point the OpenSearch term filter at the indexed name.
      // PostgreSQL RLS still uses column/sessionKey above.
      searchField: "createdBy",
    },
  },
};

/** Which backend the middleware actually built (for logs / tests). */
export type CacheBackendKind = "memory" | "valkey" | "custom" | "disabled";
export type SearchBackendKind = "opensearch" | "none";
export type EmbeddingsBackendKind = "ollama" | "openai-compatible" | "custom" | "none";

function resolveCacheBackendKind(
  axis: Axis,
  wiring: { manager?: CacheManager; backend?: Cache; valkeyUrl: string; enabled: boolean },
): CacheBackendKind {
  if (!wiring.enabled || axis.cache === undefined) return "disabled";
  if (wiring.manager !== undefined || wiring.backend !== undefined) return "custom";
  return wiring.valkeyUrl ? "valkey" : "memory";
}

function resolveSearchBackendKind(axis: Axis): SearchBackendKind {
  return axis.search ? "opensearch" : "none";
}

function resolveEmbeddingsBackendKind(
  axis: Axis,
  wiring: { instance?: EmbeddingProvider; provider: string },
): EmbeddingsBackendKind {
  if (axis.embeddings === undefined) return "none";
  if (wiring.instance !== undefined) return "custom";
  return wiring.provider === "openai-compatible"
    ? "openai-compatible"
    : "ollama";
}

export interface AppContext {
  app: Express;
  axis: Axis;
  registry: ModelRegistry;
  relationships: RelationshipRegistry;
  architectures: readonly string[];
  defaultArchitecture: ArchitectureName;
  models: ModelDefinition[];
  /** Always "disabled" — caching is removed from the middleware. */
  cacheBackendKind: CacheBackendKind;
  /** Which search backend was wired ("opensearch" or "none"). */
  searchBackendKind: SearchBackendKind;
  /** Which embeddings backend was wired ("ollama", "openai-compatible", "custom", "none"). */
  embeddingsBackendKind: EmbeddingsBackendKind;
  /** True when JWT auth + security mappings are enforced on /search. */
  authEnabled: boolean;
}

interface ErrorEnvelope {
  error: {
    message: string;
    code: string;
    issues?: unknown;
  };
}

interface QuerySuccessBody {
  data: {
    rows: Record<string, unknown>[];
    rowCount: number;
  };
  meta: {
    model: string;
    architecture: ArchitectureName;
    datasource: string;
    limit?: number;
    offset?: number;
  };
}

// Map by `err.name` (stable across ValidationError, ResolutionError,
// CompilationError, ExecutionError, DatabaseError). AuthError and
// SecurityContextError are handled by instanceof above; the name-based
// fallback below keeps working even for cross-realm duplicates.
function statusForError(err: unknown): number {
  // Malformed JSON never reaches the validator: express.json()
  // (body-parser) throws a SyntaxError with status 400 first.
  if (
    err instanceof SyntaxError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { status?: unknown }).status === 400)
  ) {
    return 400;
  }
  if (err instanceof AuthError) {
    return err.statusCode;
  }
  if (err instanceof SecurityContextError) {
    return 403;
  }
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "ValidationError":
      return 400;
    case "SecurityContextError":
      return 403;
    case "ResolutionError":
    case "CompilationError":
      return 422;
    case "ExecutionError":
    case "DatabaseError":
      return 502;
    default:
      if (err instanceof Error && /not registered/i.test(err.message)) return 422;
      return 500;
  }
}

function toErrorEnvelope(err: unknown): ErrorEnvelope {
  const status = statusForError(err);
  const name = err instanceof Error && err.name ? err.name : "";
  const code =
    status === 400 && (name === "SyntaxError" || name === "")
      ? "InvalidJson"
      : name || "InternalError";
  const message =
    status === 500 || status === 502
      ? "Query failed. Check server logs for details."
      : err instanceof Error
        ? err.message
        : String(err);
  const issues =
    err instanceof Error && "issues" in err
      ? (err as { issues?: unknown }).issues
      : undefined;
  return { error: { message, code, ...(issues ? { issues } : {}) } };
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Render an unvalidated `axes`/`metrics` value for request logging:
 * arrays become comma-joined, everything else becomes a `?` placeholder
 * (validation downstream decides whether it is acceptable).
 */
function summarizeList(value: unknown): string {
  if (!Array.isArray(value)) return "?";
  return value.map((v) => String(v)).join(",") || "-";
}

/**
 * Trim indexed documents for display: embedding vectors (or any other
 * oversized array) become `{ truncated: true, length, preview }` so
 * inspection endpoints don't dump hundreds of floats per doc.
 */
function truncateDocForDisplay(
  source: Record<string, unknown>,
  vectorField = "embedding",
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value) && (key === vectorField || value.length > 20)) {
      out[key] = {
        truncated: true,
        length: value.length,
        preview: value.slice(0, 8),
      };
    }
  }
  return out;
}

export function createApp(
  databaseUrl: string,
  cacheOptions: CreateAppOptions = {},
): AppContext {
  //model registry — Architecture A (legacy) + A2 (multi-model) share one
  // registry; per-request architecture selection happens via X-Axis-Target.
  const registry = new ModelRegistry();
  const relationships = createA2Relationships();
  const models: ModelDefinition[] = [
    PurchaseRequisitions,
    Companies,
    CompanyInfo,
    ContactInfo,
    FinancialInfo,
  ];
  for (const model of models) {
    registry.register(model);
  }

  // --- CACHING DISABLED (middleware): every request must reach OpenSearch. ---
  // --- The `cache*` options in CreateAppOptions are accepted but ignored. ---
  // // --- cache wiring: MemoryCache for dev, ValkeyCache when VALKEY_URL set ---
  // const cacheEnabled = cacheOptions.cacheEnabled ?? true;
  // const cacheTtlMs = cacheOptions.cacheTtlMs ?? 60_000;
  // const valkeyUrl = cacheOptions.valkeyUrl ?? "";

  // --- OpenSearch wiring (Phase 2) ---
  const opensearchUrl = cacheOptions.opensearchUrl ?? "";
  const opensearchUsername = cacheOptions.opensearchUsername ?? "";
  const opensearchPassword = cacheOptions.opensearchPassword ?? "";
  const opensearchIndexPrefix = cacheOptions.opensearchIndexPrefix ?? "";
  const opensearchSslRejectUnauthorized = cacheOptions.opensearchSslRejectUnauthorized ?? true;

  // Auth owns identity; the library only receives the generic context.
  // No jwtSecret => open mode (no auth middleware, no security mappings).
  const jwtSecret = cacheOptions.jwtSecret ?? "";
  const authEnabled = jwtSecret.length > 0;
  const security = authEnabled
    ? (cacheOptions.security ?? DEFAULT_SECURITY)
    : undefined;

  // Build OpenSearch adapter if URL provided
  let searchAdapter: SearchAdapter | undefined = cacheOptions.searchAdapter;
  if (searchAdapter === undefined && opensearchUrl) {
    const opensearchConfig: OpenSearchConfig = {
      enabled: true,
      url: opensearchUrl,
      ...(opensearchUsername && opensearchPassword
        ? { username: opensearchUsername, password: opensearchPassword }
        : {}),
      ...(opensearchIndexPrefix ? { indexPrefix: opensearchIndexPrefix } : {}),
      ssl: {
        rejectUnauthorized: opensearchSslRejectUnauthorized,
      },
    };
    searchAdapter = new OpenSearchAdapter(opensearchConfig);
  }

  // --- Embeddings wiring (Phase 7) ---
  const embeddingUrl = cacheOptions.embeddingUrl ?? "";
  const embeddingProviderName = cacheOptions.embeddingProvider ?? "ollama";
  const embeddingModel = cacheOptions.embeddingModel ?? "";
  const embeddingApiKey = cacheOptions.embeddingApiKey ?? "";
  const embeddingDimensions = cacheOptions.embeddingDimensions;

  let embeddingProvider: EmbeddingProvider | undefined =
    cacheOptions.embeddingProviderInstance;
  if (embeddingProvider === undefined && embeddingUrl && embeddingModel) {
    const providerOptions = {
      baseURL: embeddingUrl,
      model: embeddingModel,
      ...(embeddingApiKey ? { apiKey: embeddingApiKey } : {}),
      ...(embeddingDimensions !== undefined
        ? { dimensions: embeddingDimensions }
        : {}),
    };
    embeddingProvider =
      embeddingProviderName === "openai-compatible"
        ? new OpenAICompatibleEmbeddingProvider(providerOptions)
        : new OllamaEmbeddingProvider(providerOptions);
  }

  // Caching is OFF: Axis always gets `enabled: false` (always-miss) so every
  // /search request executes against OpenSearch. Direct SQL stays available in
  // the library (`axis.query`) for future cron jobs — never via HTTP.
  const axis: Axis = new Axis({
    database: { url: databaseUrl },
    registry,
    relationships,
    architectures: { ...ARCHITECTURE_DATASOURCE },
    cache: { enabled: false },
    ...(security !== undefined ? { security } : {}),
    ...(searchAdapter !== undefined ? { searchAdapter } : {}),
    ...(embeddingProvider !== undefined
      ? { embeddings: { instance: embeddingProvider } }
      : {}),
  });

  // // --- REMOVED cache wiring (MemoryCache / ValkeyCache / custom manager) ---
  // let axis: Axis;
  // if (cacheOptions.cacheManager !== undefined) {
  //
  //   axis = new Axis({
  //     database: { url: databaseUrl },
  //     registry,
  //     cache: { manager: cacheOptions.cacheManager },
  //     ...(security !== undefined ? { security } : {}),
  //     ...(searchAdapter !== undefined ? { searchAdapter } : {}),
  //     ...(embeddingProvider !== undefined
  //       ? { embeddings: { instance: embeddingProvider } }
  //       : {}),
  //   });
  // } else {
  //
  //   const backend: Cache =
  //     cacheOptions.cacheBackend ??
  //     (valkeyUrl
  //       ? new ValkeyCache({ url: valkeyUrl })
  //       : new MemoryCache());
  //   axis = new Axis({
  //     database: { url: databaseUrl },
  //     registry,
  //     cache: { enabled: cacheEnabled, ttl: cacheTtlMs, backend },
  //     ...(security !== undefined ? { security } : {}),
  //     ...(searchAdapter !== undefined ? { searchAdapter } : {}),
  //     ...(embeddingProvider !== undefined
  //       ? { embeddings: { instance: embeddingProvider } }
  //       : {}),
  //   });
  // }
  //
  // const backendKind: CacheBackendKind = resolveCacheBackendKind(axis, {
  //   manager: cacheOptions.cacheManager,
  //   backend: cacheOptions.cacheBackend,
  //   valkeyUrl,
  //   enabled: cacheEnabled,
  // });
  const backendKind: CacheBackendKind = "disabled";

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // CORS for browser clients (axis-playground on :3001 and similar).
  // Open to any origin by design for local dev; Authorization header allowed.
  // X-Axis-Target selects the logical architecture (A / A2 / C).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Axis-Target",
    );
    res.setHeader("Access-Control-Expose-Headers", "X-Axis-Architecture, X-Axis-Datasource");
    next();
  });
  app.options(/.*/, (_req: Request, res: Response) => {
    res.status(204).end();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });


  app.get("/models", (_req: Request, res: Response) => {
    res.json({
      data: registry.getAll().map((m) => ({
        name: m.name,
        dataset: m.dataset ?? m.name.toLowerCase(),
        axes: Object.keys(m.axes),
        metrics: Object.keys(m.metrics),
        description: m.description ?? null,
        architectures: (ARCHITECTURES as readonly string[]).filter((a) =>
          (ARCHITECTURE_MODELS[a] ?? []).includes(m.name),
        ),
      })),
    });
  });

  // --- Architecture discovery ---
  // GET /architectures -> logical architectures (A / A2 / C) with their
  // physical datasource + member models. Defined here in middleware;
  // the library only sees the generic datasource name.
  app.get("/architectures", (_req: Request, res: Response) => {
    res.json({
      data: (ARCHITECTURES as readonly string[]).map((name) => ({
        name,
        datasource: ARCHITECTURE_DATASOURCE[name],
        models: ARCHITECTURE_MODELS[name] ?? [],
        default: name === DEFAULT_ARCHITECTURE,
      })),
      meta: { default: DEFAULT_ARCHITECTURE },
    });
  });

  // --- OpenSearch inspection (read-only, like /models) ---
  // (Auth guard registered here — before the routes — so it actually runs.
  // Express executes middleware in registration order.)
  if (authEnabled) {
    app.use("/os", createAuthMiddleware(jwtSecret));
  }
  // GET /os/indices      -> per-model index name + doc count (match_all, size 0)
  // GET /os/docs/:model  -> sample docs (match_all, vectors truncated).
  //   ?limit= (default 10, max 100) &offset= (default 0).
  // Docs are tenant-filtered whenever a security context is present
  // (same term filters as /search); counts are cluster-wide by design.
  app.get(
    "/os/indices",
    asyncHandler(async (_req: Request, res: Response) => {
      if (axis.search === undefined) {
        res.status(503).json({
          error: { message: "Search is not configured.", code: "SearchNotConfigured" },
        } satisfies ErrorEnvelope);
        return;
      }
      const entries: Array<{
        model: string;
        index: string;
        docs?: number;
        error?: string;
      }> = [];
      for (const m of registry.getAll()) {
        const index = m.search?.index ?? m.name;
        try {
          const result = await axis.search.search({
            index,
            query: { matchAll: {} },
            size: 0,
          });
          entries.push({
            model: m.name,
            index,
            docs: typeof result.total === "number" ? result.total : result.total.value,
          });
        } catch (err) {
          entries.push({
            model: m.name,
            index,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      res.json({ data: entries });
    }),
  );

  app.get(
    "/os/docs/:model",
    asyncHandler(async (req: Request, res: Response) => {
      const modelName = req.params.model as string;
      const model = registry.get(modelName); // throws -> 422 when unknown
      if (axis.search === undefined) {
        res.status(503).json({
          error: { message: "Search is not configured.", code: "SearchNotConfigured" },
        } satisfies ErrorEnvelope);
        return;
      }
      const index = model.search?.index ?? model.name;
      const rawLimit = Number(req.query.limit ?? 10);
      const rawOffset = Number(req.query.offset ?? 0);
      // Inspection endpoint: allow full-page browsing up to the
      // OpenSearch default max_result_window (10_000 stay well under it).
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 1000)
        : 10;
      const offset = Number.isFinite(rawOffset)
        ? Math.max(Math.floor(rawOffset), 0)
        : 0;

      const context = (req as AuthenticatedRequest).axisContext;
      // Shared-catalog models skip engine term filters (same rule as
      // searchDocuments: no tenant column, auth still enforced).
      const sharedCatalog = model.security?.openSearch?.shared === true;
      const securityFilters =
        sharedCatalog || security === undefined || context === undefined
          ? []
          : buildOpenSearchSecurityFilters(context, security);
      const query: SearchQuery =
        securityFilters.length > 0
          ? { bool: { filter: securityFilters as SearchQuery[] } }
          : { matchAll: {} };

      const result = await axis.search.search({
        index,
        query,
        size: limit,
        from: offset,
        trackTotalHits: true,
      });
      const total =
        typeof result.total === "number" ? result.total : result.total.value;
      const vectorField = model.search?.embeddingField ?? "embedding";
      res.json({
        data: {
          rows: result.hits.map((hit) => ({
            ...truncateDocForDisplay(hit._source, vectorField),
            _id: hit._id,
            ...(hit._score !== undefined ? { _score: hit._score } : {}),
          })),
          rowCount: result.hits.length,
        },
        meta: { model: modelName, index, total, limit, offset },
      });
    }),
  );

  // Authentication (when jwtSecret is configured): every /search request
  // must carry `Authorization: Bearer <JWT>`. Verified here, converted to
  // a generic AxisContext, and passed to the engine per request.
  // (Direct-SQL /query routes removed: middleware HTTP serves OpenSearch only.
  // SQL stays available in the library for future cron jobs.)
  if (authEnabled) {
    // app.use("/query", createAuthMiddleware(jwtSecret));
    app.use("/search", createAuthMiddleware(jwtSecret));
  }

  /* DISABLED — direct-SQL HTTP path removed (OpenSearch-only middleware).
     Kept for the future cron-job wiring; do not re-enable for user traffic.
  // POST /query { model, axes?, metrics?, filters?, orderBy?, limit?, offset? }
  // POST /query/:model — convenience: model taken from the URL path.
  // Cached transparently by the Axis engine (MemoryCache in dev):
  // 1st identical query MISSes (runs SQL), repeats HIT (no SQL).
  // Cache keys are tenant-bound whenever security is configured.
  app.post(
    ["/query", "/query/:model"],
    asyncHandler(async (req: Request, res: Response) => {
      const input: AxisQuery =
        typeof req.params.model === "string"
          ? { ...(req.body as object), model: req.params.model }
          : (req.body as AxisQuery);

      const context = (req as AuthenticatedRequest).axisContext;
      const result = await axis.query<Record<string, unknown>>(
        input,
        context === undefined ? undefined : { context },
      );

      const body: QuerySuccessBody = {
        data: {
           rows: result.rows,
           rowCount: result.rowCount
          },
        meta: {
          model: input.model,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
        },
      };
      res.json(body);
    }),
  );
  */

  // POST /search { model, search: { type, text, fields?, k? }, filters?, limit?, offset? }
  // POST /search/:model — convenience: model taken from the URL path.
  // Architecture selection via `X-Axis-Target` header (A / A2 / C,
  // default A2):
  //   A/A2 -> OpenSearch path end-to-end (embed → DSL → adapter → rows).
  //   C    -> 501 (S3 JSON datasource lands next; same semantic models).
  // Runs the OpenSearch path end-to-end (Phase 9): embed (semantic/hybrid) →
  // compile to DSL → search adapter → normalized rows. Cached with the same
  // security-aware keys as /query. Requires a search adapter (503 otherwise).
  app.post(
    ["/search", "/search/:model"],
    asyncHandler(async (req: Request, res: Response) => {
      let architecture: ArchitectureName;
      try {
        architecture = parseArchitectureHeader(req.header("X-Axis-Target"));
      } catch (err) {
        res.status(400).json({
          error: {
            message: err instanceof Error ? err.message : String(err),
            code: "UnknownArchitecture",
          },
        } satisfies ErrorEnvelope);
        return;
      }
      const datasource = datasourceForArchitecture(architecture);

      // Architecture C (S3 + engine) is declared but not implemented yet.
      if (datasource === "s3-json") {
        res.status(501).json({
          error: {
            message: `Architecture "${architecture}" (S3 JSON source + Axis execution) is not implemented yet. Retry with X-Axis-Target: A2.`,
            code: "ArchitectureNotImplemented",
          },
        } satisfies ErrorEnvelope);
        return;
      }

      const input: AxisQuery =
        typeof req.params.model === "string"
          ? { ...(req.body as object), model: req.params.model }
          : (req.body as AxisQuery);

      // One line per executed query: which logical architecture and
      // physical datasource served it, and what was asked for.
      // Defensive stringify: the body is still unvalidated here, so never
      // assume axes/metrics/filters shapes (validation runs downstream).
      console.log(
        `[search] architecture=${architecture} datasource=${datasource} ` +
          `model=${typeof (input as { model?: unknown }).model === "string" ? (input as { model: string }).model : "?"} ` +
          `axes=${summarizeList((input as { axes?: unknown }).axes)} ` +
          `metrics=${summarizeList((input as { metrics?: unknown }).metrics)} ` +
          `filters=${Array.isArray((input as { filters?: unknown }).filters) ? ((input as { filters: unknown[] }).filters.length) : "?"} ` +
          `limit=${typeof (input as { limit?: unknown }).limit === "number" ? (input as { limit: number }).limit : "-"} ` +
          `offset=${typeof (input as { offset?: unknown }).offset === "number" ? (input as { offset: number }).offset : "-"}`,
      );

      const context = (req as AuthenticatedRequest).axisContext;
      const result = await axis.searchDocuments<Record<string, unknown>>(
        input,
        context === undefined ? undefined : { context },
      );

      res.setHeader("X-Axis-Architecture", architecture);
      res.setHeader("X-Axis-Datasource", datasource);
      const body: QuerySuccessBody = {
        data: {
           rows: result.rows,
           rowCount: result.rowCount
          },
        meta: {
          model: input.model,
          architecture,
          datasource,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
        },
      };
      res.json(body);
    }),
  );

  /* DISABLED — caching removed from the middleware (every request hits OpenSearch).
     Route reference kept for docs; re-enable only if a cache story returns.
  // --- Cache observability + invalidation (implements every CacheManager method) ---
  // GET /cache/stats        -> CacheManager.stats()
  // GET /cache/entries      -> list cached keys + values (inspect data, not just stats)
  // GET /cache/key?model=&... -> CacheManager.keyFor(query) (debug: what key a query maps to)
  // DELETE /cache           -> CacheManager.clear()
  // DELETE /cache/:model    -> CacheManager.invalidateModel(model)
  // POST /cache/reset-stats -> CacheManager.resetStats()
  app.get(
    "/cache/stats",
    asyncHandler(async (_req: Request, res: Response) => {
      const enabled = axis.cache?.isEnabled ?? false;
      if (!enabled) {
        res.json({ data: { enabled: false, backend: backendKind, stats: null } });
        return;
      }
      const stats = await axis.cache!.stats();
      const hits = stats.hits;
      const misses = stats.misses;
      res.json({
        data: {
          enabled: true,
          backend: backendKind,
          stats,
          hitRatio: hits + misses === 0 ? null : hits / (hits + misses),
        },
      });
    }),
  );

  app.get(
    "/cache/entries",
    asyncHandler(async (req: Request, res: Response) => {
      const enabled = axis.cache?.isEnabled ?? false;
      if (!enabled || axis.cache === undefined) {
        res.json({
          data: {
            enabled: false,
            backend: backendKind,
            total: 0,
            count: 0,
            entries: [],
          },
        });
        return;
      }

      const manager = axis.cache as unknown as {
        backend?: Cache & {
          store?: Map<string, { value: unknown; expiresAt?: number }>;
          get?: (key: string) => Promise<unknown>;
        };
        keysByModel?: Map<string, Set<string>>;
      };
      const backend = manager.backend;
      const keysByModel = manager.keysByModel;

      // Reverse index: cache key -> real model name (tracked on every set).
      const keyToModel = new Map<string, string>();
      if (keysByModel !== undefined) {
        for (const [model, keys] of keysByModel) {
          for (const key of keys) {
            if (!keyToModel.has(key)) keyToModel.set(key, model);
          }
        }
      }

      const modelFromKey = (key: string): string => {
        const last = key.lastIndexOf(":");
        if (last <= 0) return "";
        const withoutDigest = key.slice(0, last);
        const prev = withoutDigest.lastIndexOf(":");
        return prev < 0 ? withoutDigest : withoutDigest.slice(prev + 1);
      };

      const modelFilter =
        typeof req.query.model === "string" && req.query.model.length > 0
          ? req.query.model
          : undefined;
      const rawLimit = Number(req.query.limit ?? 100);
      const rawOffset = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 1000)
        : 100;
      const offset = Number.isFinite(rawOffset)
        ? Math.max(Math.floor(rawOffset), 0)
        : 0;
      const includeValuesRaw = req.query.includeValues;
      const includeValues =
        includeValuesRaw === undefined
          ? true
          : !["false", "0", "no", "off"].includes(
              String(includeValuesRaw).toLowerCase(),
            );

      const matchesModel = (key: string): boolean => {
        if (modelFilter === undefined) return true;
        const tracked = keyToModel.get(key);
        if (tracked !== undefined) return tracked === modelFilter;
        return modelFromKey(key) === modelFilter;
      };

      interface EntryView {
        key: string;
        model: string;
        value?: unknown;
        expiresAt?: number | null;
        ttlRemainingMs?: number | null;
      }

      const now = Date.now();
      let all: EntryView[] = [];

      // Fast path: MemoryCache-like backend exposes its Map authoritatively
      // (survives any tracking drift; also gives expiry info).
      if (backend?.store instanceof Map) {
        for (const [key, entry] of backend.store) {
          if (!matchesModel(key)) continue;
          const expiresAt = entry?.expiresAt ?? null;
          if (expiresAt !== null && now >= expiresAt) continue; // expired, not yet reaped
          all.push({
            key,
            model: keyToModel.get(key) ?? modelFromKey(key),
            ...(includeValues ? { value: (entry as { value: unknown }).value } : {}),
            expiresAt,
            ttlRemainingMs: expiresAt === null ? null : Math.max(expiresAt - now, 0),
          });
        }
        // Stable order for paging.
        all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      } else {
        // Generic / remote backend (Valkey, custom): re-read every tracked key.
        const keys: string[] = [];
        if (keysByModel !== undefined) {
          for (const [model, set] of keysByModel) {
            if (modelFilter !== undefined && model !== modelFilter) continue;
            for (const key of set) keys.push(key);
          }
        }
        keys.sort();
        const get = backend?.get?.bind(backend);
        for (const key of keys) {
          let value: unknown;
          try {
            value = get !== undefined ? await get(key) : undefined;
          } catch {
            continue; // fail-open: skip unreadable entries
          }
          if (value === undefined) continue; // expired / evicted / corrupt
          all.push({
            key,
            model: keyToModel.get(key) ?? modelFromKey(key),
            ...(includeValues ? { value } : {}),
          });
        }
        // keysByModel already filtered by exact model name; store path
        // filters via matchesModel() above — nothing left to do here.
      }

      const total = all.length;
      const page = all.slice(offset, offset + limit);
      res.json({
        data: {
          enabled: true,
          backend: backendKind,
          total,
          count: page.length,
          offset,
          limit,
          entries: page,
        },
      });
    }),
  );

  app.get(
    "/cache/key",
    asyncHandler(async (req: Request, res: Response) => {
      if (axis.cache === undefined) {
        res.status(503).json({
          error: { message: "Cache is not configured.", code: "CacheDisabled" },
        } satisfies ErrorEnvelope);
        return;
      }
      // Rebuild an AxisQuery from querystring params for debugging.
      // e.g. /cache/key?model=PurchaseRequisitions&metrics=newCount&axes=department
      const query: AxisQuery = {
        model: String(req.query.model ?? ""),
        ...(req.query.axes !== undefined
          ? { axes: String(req.query.axes).split(",").filter(Boolean) }
          : {}),
        ...(req.query.metrics !== undefined
          ? { metrics: String(req.query.metrics).split(",").filter(Boolean) }
          : {}),
      };
      try {
        const key = axis.cache.keyFor(query);
        res.json({ data: { key, query } });
      } catch (err) {
        res.status(400).json(toErrorEnvelope(err));
      }
    }),
  );

  app.post("/cache/reset-stats", (_req: Request, res: Response) => {
    axis.cache?.resetStats();
    res.json({ data: { ok: true } });
  });

  app.delete(
    "/cache/:model",
    asyncHandler(async (req: Request, res: Response) => {
      // CacheManager.invalidateModel(model): forget one model's queries.
      // Call after any write path touching that model.
      const removed = await axis.invalidateModel(req.params.model as string);
      res.json({ data: { model: req.params.model, removed } });
    }),
  );

  app.delete(
    "/cache",
    asyncHandler(async (_req: Request, res: Response) => {
      // CacheManager.clear(): forget everything (schema resets).
      await axis.cache?.clear();
      res.json({ data: { ok: true } });
    }),
  );
  */

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: { message: `Not found: ${req.method} ${req.path}`, code: "NotFound" },
    } satisfies ErrorEnvelope);
  });

  // Central error handler — must have 4 args to be picked up by Express.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(statusForError(err)).json(toErrorEnvelope(err));
  });

  const searchBackendKind: SearchBackendKind = resolveSearchBackendKind(axis);
  const embeddingsBackendKind: EmbeddingsBackendKind =
    resolveEmbeddingsBackendKind(axis, {
      instance: cacheOptions.embeddingProviderInstance,
      provider: embeddingProviderName,
    });

  return { app, axis, registry, relationships, architectures: ARCHITECTURES, defaultArchitecture: DEFAULT_ARCHITECTURE, models, cacheBackendKind: backendKind, searchBackendKind, embeddingsBackendKind, authEnabled };
}
