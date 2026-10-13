import { parseAxisQuery } from "../query/validator.js";
import { buildQueryAST } from "../../ast/builder.js";
import { resolveQuery } from "../resolver/resolver.js";
import { compileQuery } from "../compiler/compiler.js";
import { resolveSecurityContext } from "../security/resolver.js";

import type { Database } from "../database/database.js";
import type { QueryResult } from "../executor/types.js";
import { PostgreSQLExecutor } from "../executor/executor.js";
import { defaultModelRegistry } from "../../model/registry.js";
import type { ModelRegistry } from "../../model/registry.js";
import type { CacheManager } from "../cache/cache-manager.js";
import type { QueryEngine, QueryOptions } from "./types.js";
import type { AxisSecurityConfig } from "../security/types.js";

export interface AxisQueryEngineOptions {
  registry?: ModelRegistry;
  cache?: CacheManager;
  cacheManager?: CacheManager;
  security?: AxisSecurityConfig;
}

export class AxisQueryEngine implements QueryEngine {
  private readonly executor: PostgreSQLExecutor;
  private readonly registry: ModelRegistry;
  private readonly cache: CacheManager | undefined;
  private readonly security: AxisSecurityConfig | undefined;

  constructor(
    database: Database,
    registryOrOptions: ModelRegistry | AxisQueryEngineOptions = defaultModelRegistry,
    cache?: CacheManager,
  ) {
    const parsed = parseConstructorArgs(registryOrOptions, cache);
    this.executor = new PostgreSQLExecutor(database);
    this.registry = parsed.registry;
    this.cache = parsed.cache;
    this.security = parsed.security;
  }

  async query<T = Record<string, unknown>>(
    input: unknown,
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const query = parseAxisQuery(input);
    const ast = buildQueryAST(query);
    const model = this.registry.get(query.model);
    const resolved = resolveQuery(ast, model);

    const resolvedSecurity =
      this.security === undefined
        ? undefined
        : resolveSecurityContext(options.context ?? {}, this.security);

    const securityCacheKey = resolvedSecurity?.cacheKey;

    if (this.cache !== undefined) {
      const cached = await this.cache.get<QueryResult<T>>(query, securityCacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const compiled = compileQuery(resolved);
    const result = await this.executor.execute<T>(compiled, resolvedSecurity);

    if (this.cache !== undefined) {
      await this.cache.set<QueryResult<T>>(query, result, query.cacheTtl, securityCacheKey);
    }

    return result;
  }

  getRegistry(): ModelRegistry {
    return this.registry;
  }

  getCache(): CacheManager | undefined {
    return this.cache;
  }

  getSecurityConfig(): AxisSecurityConfig | undefined {
    return this.security;
  }
}

function parseConstructorArgs(
  registryOrOptions: ModelRegistry | AxisQueryEngineOptions,
  cache: CacheManager | undefined,
): { registry: ModelRegistry; cache: CacheManager | undefined; security: AxisSecurityConfig | undefined } {
  if (isModelRegistry(registryOrOptions)) {
    return {
      registry: registryOrOptions,
      cache,
      security: undefined,
    };
  }
  const options = registryOrOptions;
  return {
    registry: options.registry ?? defaultModelRegistry,
    cache: options.cacheManager ?? options.cache ?? cache,
    security: options.security,
  };
}

function isModelRegistry(value: unknown): value is ModelRegistry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate["get"] === "function" && typeof candidate["register"] === "function";
}
