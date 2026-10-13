import { createPool } from "./pool.js";
import { DatabaseError } from "./errors.js";
export class Database {
    pool;
    constructor(config) {
        try {
            this.pool = createPool(config);
        }
        catch (error) {
            throw new DatabaseError("Failed to initialize database connection pool.", undefined, error);
        }
    }
    async query(sql, parameters = []) {
        try {
            return await this.pool.query(sql, parameters);
        }
        catch (error) {
            throw new DatabaseError(this.getErrorMessage(error), error?.code, error);
        }
    }
    async testConnection() {
        try {
            await this.pool.query("SELECT 1");
        }
        catch (error) {
            throw new DatabaseError(this.getConnectionErrorMessage(error), error?.code, error);
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
    async transaction(callback) {
        let client;
        try {
            client = await this.pool.connect();
        }
        catch (error) {
            throw new DatabaseError(this.getErrorMessage(error), error?.code, error);
        }
        try {
            try {
                await client.query("BEGIN");
            }
            catch (error) {
                throw new DatabaseError(this.getErrorMessage(error), error?.code, error);
            }
            try {
                const result = await callback(client);
                try {
                    await client.query("COMMIT");
                }
                catch (error) {
                    throw new DatabaseError(this.getErrorMessage(error), error?.code, error);
                }
                return result;
            }
            catch (error) {
                try {
                    await client.query("ROLLBACK");
                }
                catch {
                    // Rollback failure must not mask the original error.
                }
                throw error;
            }
        }
        finally {
            client.release();
        }
    }
    async close() {
        try {
            await this.pool.end();
        }
        catch (error) {
            throw new DatabaseError("Failed to close database connection pool.", error?.code, error);
        }
    }
    getPool() {
        return this.pool;
    }
    getConnectionErrorMessage(error) {
        switch (error?.code) {
            case "28P01":
                return ("Database authentication failed. " +
                    "Check DATABASE_URL username and password.");
            case "3D000":
                return (`Database "${error?.database ?? "unknown"}" does not exist. ` +
                    "Check the database name in DATABASE_URL.");
            case "ECONNREFUSED":
                return ("Could not connect to PostgreSQL. " +
                    "Check that PostgreSQL is running and the host/port are correct.");
            case "ENOTFOUND":
                return ("Database host could not be resolved. " +
                    "Check the hostname in DATABASE_URL.");
            default:
                return (`Database connection failed` +
                    `${error?.message ? `: ${error.message}` : "."}`);
        }
    }
    getErrorMessage(error) {
        return (`Database query failed` +
            `${error?.message ? `: ${error.message}` : "."}`);
    }
}
//# sourceMappingURL=database.js.map