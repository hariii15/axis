import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type { DatabaseConfig } from "./types.js";
export declare class Database {
    private readonly pool;
    constructor(config: DatabaseConfig);
    query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<QueryResult<T>>;
    testConnection(): Promise<void>;
    /**
     * Run a callback inside a PostgreSQL transaction (Phase 8).
     *
     * Acquires one pooled client, issues BEGIN, runs the callback,
     * COMMITs on success and ROLLBACKs on error. The client is always
     * released. `SET LOCAL` inside this transaction is scoped to the
     * transaction only, so pooled connections never leak security
     * context between requests.
     */
    transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
    getPool(): Pool;
    private getConnectionErrorMessage;
    private getErrorMessage;
}
//# sourceMappingURL=database.d.ts.map