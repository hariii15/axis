import { parseAxisQuery } from "../query/validator.js";
import { buildQueryAST } from "../../ast/builder.js";
import { resolveQuery } from "../resolver/resolver.js";
import { compileQuery } from "../compiler/compiler.js";
import { resolveSecurityContext } from "../security/resolver.js";
import { PostgreSQLExecutor } from "../executor/executor.js";
import { defaultModelRegistry } from "../../model/registry.js";
export class AxisQueryEngine {
    executor;
    registry;
    cache;
    security;
    constructor(database, registryOrOptions = defaultModelRegistry, cache) {
        const parsed = parseConstructorArgs(registryOrOptions, cache);
        this.executor = new PostgreSQLExecutor(database);
        this.registry = parsed.registry;
        this.cache = parsed.cache;
        this.security = parsed.security;
    }
    async query(input, options = {}) {
        const query = parseAxisQuery(input);
        const ast = buildQueryAST(query);
        const model = this.registry.get(query.model);
        const resolved = resolveQuery(ast, model);
        const resolvedSecurity = this.security === undefined
            ? undefined
            : resolveSecurityContext(options.context ?? {}, this.security);
        const securityCacheKey = resolvedSecurity?.cacheKey;
        if (this.cache !== undefined) {
            const cached = await this.cache.get(query, securityCacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }
        const compiled = compileQuery(resolved);
        const result = await this.executor.execute(compiled, resolvedSecurity);
        if (this.cache !== undefined) {
            await this.cache.set(query, result, query.cacheTtl, securityCacheKey);
        }
        return result;
    }
    getRegistry() {
        return this.registry;
    }
    getCache() {
        return this.cache;
    }
    getSecurityConfig() {
        return this.security;
    }
}
function parseConstructorArgs(registryOrOptions, cache) {
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
function isModelRegistry(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return typeof candidate["get"] === "function" && typeof candidate["register"] === "function";
}
//# sourceMappingURL=query-engine.js.map