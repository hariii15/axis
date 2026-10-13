import type { Database } from "../database/database.js";
import type { CompiledQuery } from "../compiler/types.js";
import type { ResolvedSecurityContext } from "../security/types.js";
import type { QueryExecutor, QueryResult } from "./types.js";
export declare class PostgreSQLExecutor implements QueryExecutor {
    private readonly database;
    constructor(database: Database);
    execute<T = Record<string, unknown>>(query: CompiledQuery, security?: ResolvedSecurityContext): Promise<QueryResult<T>>;
    private formatSql;
}
//# sourceMappingURL=executor.d.ts.map