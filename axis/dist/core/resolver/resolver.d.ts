import type { ModelDefinition } from "../../model/types.js";
import type { ModelRegistry } from "../../model/registry.js";
import type { RelationshipRegistry } from "../../model/relationship.js";
import type { QueryAST } from "../../ast/types.js";
import type { ResolvedQuery } from "./type.js";
export interface MultiModelResolveOptions {
    registry: ModelRegistry;
    relationships?: RelationshipRegistry;
}
/**
 * Resolve a query AST against one model (legacy) or a registry.
 *
 * - `resolveQuery(ast, model)` — single-model path. Bare names only,
 *   except `Model.field` refs that name the same model.
 * - `resolveQuery(ast, { registry, relationships? })` — multi-model
 *   path. Dotted refs (`ContactInfo.email`) resolve via the registry;
 *   join steps resolve via the relationship registry.
 */
export declare function resolveQuery(ast: QueryAST, model: ModelDefinition): ResolvedQuery;
export declare function resolveQuery(ast: QueryAST, options: MultiModelResolveOptions): ResolvedQuery;
//# sourceMappingURL=resolver.d.ts.map