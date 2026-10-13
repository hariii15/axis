import type { CompiledQuery } from "../compiler/types.js";
import type { ResolvedSecurityContext } from "../security/types.js";
export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount: number;
}
export interface QueryExecutor {
    execute<T = Record<string, unknown>>(query: CompiledQuery, security?: ResolvedSecurityContext): Promise<QueryResult<T>>;
}
//# sourceMappingURL=types.d.ts.map