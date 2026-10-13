import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import { createPool } from "./pool.js";
import type { DatabaseConfig } from "./types.js";
import { DatabaseError } from "./errors.js";

export class Database {
  private readonly pool: Pool;

  constructor(config: DatabaseConfig) {
    try {
      this.pool = createPool(config);
    } catch (error) {
      throw new DatabaseError(
        "Failed to initialize database connection pool.",
        undefined,
        error,
      );
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(sql, parameters);
    } catch (error: any) {
      throw new DatabaseError(
        this.getErrorMessage(error),
        error?.code,
        error,
      );
    }
  }

  async testConnection(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
    } catch (error: any) {
      throw new DatabaseError(
        this.getConnectionErrorMessage(error),
        error?.code,
        error,
      );
    }
  }

  /**
   * Run a callback inside a PostgreSQL transaction (Phase 8).
   *
   * Acquires one pooled client, issues BEGIN, runs the callback,
   * COMMITs on success and ROLLBACKs on error. The client is always
   * released. `SET LOCAL` inside this transaction is scoped to the
   * transaction only, so pooled connections never leak security
   * context between requests.
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error: any) {
      throw new DatabaseError(
        this.getErrorMessage(error),
        error?.code,
        error,
      );
    }
    try {
      try {
        await client.query("BEGIN");
      } catch (error: any) {
        throw new DatabaseError(
          this.getErrorMessage(error),
          error?.code,
          error,
        );
      }
      try {
        const result = await callback(client);
        try {
          await client.query("COMMIT");
        } catch (error: any) {
          throw new DatabaseError(
            this.getErrorMessage(error),
            error?.code,
            error,
          );
        }
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Rollback failure must not mask the original error.
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
    } catch (error: any) {
      throw new DatabaseError(
        "Failed to close database connection pool.",
        error?.code,
        error,
      );
    }
  }

  getPool(): Pool {
    return this.pool;
  }

  private getConnectionErrorMessage(error: any): string {
    switch (error?.code) {
      case "28P01":
        return (
          "Database authentication failed. " +
          "Check DATABASE_URL username and password."
        );

      case "3D000":
        return (
          `Database "${error?.database ?? "unknown"}" does not exist. ` +
          "Check the database name in DATABASE_URL."
        );

      case "ECONNREFUSED":
        return (
          "Could not connect to PostgreSQL. " +
          "Check that PostgreSQL is running and the host/port are correct."
        );

      case "ENOTFOUND":
        return (
          "Database host could not be resolved. " +
          "Check the hostname in DATABASE_URL."
        );

      default:
        return (
          `Database connection failed` +
          `${error?.message ? `: ${error.message}` : "."}`
        );
    }
  }

  private getErrorMessage(error: any): string {
    return (
      `Database query failed` +
      `${error?.message ? `: ${error.message}` : "."}`
    );
  }
}