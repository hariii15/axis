import type { AxisQuery } from "../query/types.js";
import type { QueryResult } from "../executor/types.js";
import type { AxisContext } from "../context/types.js";
export interface QueryOptions {
    context?: AxisContext;
}
export interface QueryEngine {
    query<T = Record<string, unknown>>(query: AxisQuery, options?: QueryOptions): Promise<QueryResult<T>>;
}
//# sourceMappingURL=types.d.ts.map