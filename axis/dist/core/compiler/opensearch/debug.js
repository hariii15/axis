import { parseAxisQuery } from "../../../core/query/validator.js";
import { buildQueryAST } from "../../../ast/builder.js";
import { resolveQuery } from "../../../core/resolver/resolver.js";
import { compileToOpenSearch } from "./index.js";
export function debugCompileToOpenSearch(input, model) {
    const query = parseAxisQuery(input);
    const ast = buildQueryAST(query);
    const resolved = resolveQuery(ast, model);
    const dsl = compileToOpenSearch(resolved);
    console.log("=== Axis OpenSearch Compilation Pipeline ===");
    console.log("\n[1] Input Query:");
    console.log(JSON.stringify(query, null, 2));
    console.log("\n[2] AST:");
    console.log(JSON.stringify(ast, null, 2));
    console.log("\n[3] Resolved Query:");
    console.log(JSON.stringify(resolved, (key, value) => {
        if (key === "model")
            return "[ModelDefinition]";
        return value;
    }, 2));
    console.log("\n[4] OpenSearch DSL:");
    console.log(JSON.stringify(dsl, null, 2));
    console.log("\n=== End Pipeline ===\n");
    return { query, ast, resolved, dsl };
}
//# sourceMappingURL=debug.js.map