import type { ModelDefinition } from "../../../model/types.js";
import { parseAxisQuery } from "../../../core/query/validator.js";
import { buildQueryAST } from "../../../ast/builder.js";
import { resolveQuery } from "../../../core/resolver/resolver.js";
import { compileToOpenSearch } from "./index.js";
export declare function debugCompileToOpenSearch(input: unknown, model: ModelDefinition): {
    query: ReturnType<typeof parseAxisQuery>;
    ast: ReturnType<typeof buildQueryAST>;
    resolved: ReturnType<typeof resolveQuery>;
    dsl: ReturnType<typeof compileToOpenSearch>;
};
//# sourceMappingURL=debug.d.ts.map