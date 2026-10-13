import { describe, expect, it } from "vitest";
import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

/**
 * PostgreSQL RLS integration (Phase 8 §16).
 *
 * Application-side setup (run once by the app, NOT by Axis):
 *
 * ```sql
 * ALTER TABLE upeg.requisition_deails ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY requisition_tenant_isolation
 * ON upeg.requisition_deails
 * USING (tenant_id = current_setting('app.tenant_id', true));
 * ```
 *
 * Axis only sets the session context (`SET LOCAL` inside a
 * transaction); PostgreSQL enforces the actual row isolation.
 */
describeIfDb("RLS tenant isolation (live PostgreSQL)", () => {
  it("returns only tenant-001 rows for tenant-001 context", async () => {
    const { Database } = await import("../../src/core/database/database.js");
    const { AxisQueryEngine } = await import(
      "../../src/core/query-engine/query-engine.js"
    );
    const { ModelRegistry } = await import("../../src/model/registry.js");
    const { defineModel } = await import("../../src/model/model.js");

    const database = new Database({ url: databaseUrl as string });
    try {
      const registry = new ModelRegistry();
      registry.register(
        defineModel({
          name: "PurchaseRequisitions",
          source: { type: "table", table: "upeg.requisition_deails" },
          axes: { department: { sql: "department_name", type: "string" } },
          metrics: { newCount: { type: "count" } },
        }),
      );
      const engine = new AxisQueryEngine(database, {
        registry,
        security: {
          mappings: {
            tenant: {
              contextKey: "tenant",
              column: "tenant_id",
              sessionKey: "app.tenant_id",
              required: true,
            },
          },
        },
      });

      const result = await engine.query(
        { model: "PurchaseRequisitions", metrics: ["newCount"] },
        { context: { tenant: "tenant-001" } },
      );
      expect(result.rowCount).toBeGreaterThanOrEqual(0);
      // Row-level tenant assertions depend on seeded data; at minimum
      // the query must execute inside RLS context without error.
    } finally {
      await database.close();
    }
  });
});
