import { afterAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { Database } from "../../src/core/database/database.js";
import { PostgreSQLExecutor } from "../../src/core/executor/executor.js";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
}
const database = new Database({
    url: databaseUrl,
});
const executor = new PostgreSQLExecutor(database);
describe("PostgreSQL Executor", () => {
    it("connects to PostgreSQL", async () => {
        await expect(database.testConnection()).resolves.toBeUndefined();
    });
    it("executes a parameterized query", async () => {
        const result = await executor.execute({
            sql: "SELECT $1::integer AS value",
            parameters: [
                {
                    name: "param0",
                    value: 42,
                },
            ],
        });
        expect(result.rows).toEqual([
            {
                value: 42,
            },
        ]);
        expect(result.rowCount).toBe(1);
    });
    it("executes a query with ? placeholders converted to PostgreSQL format", async () => {
        const result = await executor.execute({
            sql: "SELECT ?::integer AS a, ?::text AS b",
            parameters: [
                {
                    name: "param0",
                    value: 100,
                },
                {
                    name: "param1",
                    value: "hello",
                },
            ],
        });
        expect(result.rows).toEqual([
            {
                a: 100,
                b: "hello",
            },
        ]);
        expect(result.rowCount).toBe(1);
    });
});
afterAll(async () => {
    await database.close();
});
//# sourceMappingURL=executor.test.js.map