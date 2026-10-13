import type { AxisQuery } from "../core/query/types.js";
import type { QueryAST } from "./types.js";
/**
 * Converts a validated AxisQuery into the
 * internal QueryAST representation.
 *
 * IMPORTANT:
 *
 * This function assumes that the query has already
 * passed runtime validation.
 *
 * It does not:
 * - validate models
 * - resolve axes
 * - resolve metrics
 * - generate SQL
 * - execute queries
 * - access the database
 */
export declare function buildQueryAST(query: AxisQuery): QueryAST;
//# sourceMappingURL=builder.d.ts.map