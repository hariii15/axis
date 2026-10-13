import type { Database } from "../database/database.js";
import type { CompiledQuery } from "../compiler/types.js";
import type { ResolvedSecurityContext } from "../security/types.js";

import type {
  QueryExecutor,
  QueryResult,
} from "./types.js";

import { ExecutionError } from "./errors.js";

export class PostgreSQLExecutor implements QueryExecutor {
  constructor(
    private readonly database: Database,
  ) {}

  async execute<T = Record<string, unknown>>(
    query: CompiledQuery,
    security?: ResolvedSecurityContext,
  ): Promise<QueryResult<T>> {
    const sql = this.formatSql(query.sql);
    const parameters = query.parameters.map(
      (parameter) => parameter.value,
    );

    try {
      // No security context: legacy direct execution (unchanged behavior).
      if (security === undefined || Object.keys(security.values).length === 0) {
        const result = await this.database.query(
          sql,
          parameters,
        );

        return {
          rows: result.rows as T[],
          rowCount: result.rowCount ?? 0,
        };
      }

      // Security context: transaction-scoped SET LOCAL via set_config().
      // Values are bound as parameters ($1, $2) — never interpolated —
      // so quotes / SQL syntax in tenant/user values cannot inject.
      // `set_config(key, value, true)` with is_local=true == SET LOCAL.
      const entries = Object.entries(security.values);
      const result = await this.database.transaction(async (client) => {
        for (const [sessionKey, sessionValue] of entries) {
          await client.query("SELECT set_config($1, $2, true)", [
            sessionKey,
            sessionValue,
          ]);
        }
        return await client.query(sql, parameters);
      });

      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? 0,
      };
    } catch (error) {
      if (error instanceof ExecutionError) {
        throw error;
      }
      throw new ExecutionError(
        "Failed to execute compiled query.",
        error,
        sql,
        parameters,
      );
    }
  }

  private formatSql(sql: string): string {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }
}