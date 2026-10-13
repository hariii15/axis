import type { Database } from "../database/database.js";
import type { QueryResult } from "../executor/types.js";
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
export declare class AxisQueryEngine implements QueryEngine {
    private readonly executor;
    private readonly registry;
    private readonly cache;
    private readonly security;
    constructor(database: Database, registryOrOptions?: ModelRegistry | AxisQueryEngineOptions, cache?: CacheManager);
    query<T = Record<string, unknown>>(input: unknown, options?: QueryOptions): Promise<QueryResult<T>>;
    getRegistry(): ModelRegistry;
    getCache(): CacheManager | undefined;
    getSecurityConfig(): AxisSecurityConfig | undefined;
}
//# sourceMappingURL=query-engine.d.ts.map