/**
 * PostgreSQL check for Axis (read-only — SELECT only, never writes).
 *
 *   1. Connection (SELECT 1)
 *   2. Source table schema (columns + types for upeg.requisition_deails)
 *   3. Row count
 *   4. Sample rows (verifies transformer/security field mapping)
 *   5. Real axis.query() end-to-end (validate → AST → SQL → PG → rows)
 *
 * Usage:
 *   npx tsx scripts/check-postgres.ts
 *
 * Exits 0 when all checks pass, 1 otherwise.
 */
import "dotenv/config";
import { Database } from "axis";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const SCHEMA = "upeg";
const TABLE = "requisition_deails";

let failures = 0;

function pass(step: string, detail = "") {
  console.log(`PASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, detail = "") {
  failures += 1;
  console.error(`FAIL: ${step}${detail ? ` — ${detail}` : ""}`);
}

function logBlock(title: string, value: unknown) {
  console.log(`\n----- ${title} -----`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const db = new Database({ url: config.databaseUrl });
  try {
    // 1. Connection.
    try {
      await db.testConnection();
      pass("connection", config.databaseUrl.replace(/:[^:@]+@/, ":***@"));
    } catch (error) {
      fail("connection", String(error));
      console.error("\nPostgreSQL unreachable — is it running? Skipping rest.");
      process.exit(1);
    }

    // 2. Schema of the source table.
    let columns: Array<{ column: string; type: string; nullable: string }> = [];
    try {
      const res = await db.query(
        `SELECT column_name AS column, data_type AS type, is_nullable AS nullable
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [SCHEMA, TABLE],
      );
      columns = res.rows as typeof columns;
      logBlock(`schema ${SCHEMA}.${TABLE} (${columns.length} columns)`, columns);
      if (columns.length === 0) {
        fail("schema", `table ${SCHEMA}.${TABLE} not found`);
      } else {
        pass("schema", `${columns.length} columns`);
      }
    } catch (error) {
      fail("schema", String(error));
    }

    const columnNames = new Set(columns.map((c) => c.column));
    for (const needed of [
      "requisition_id",
      "department_name",
      "tenant_id",
      "created_by",
    ]) {
      if (columnNames.has(needed)) {
        pass(`column present: ${needed}`);
      } else {
        fail(
          `column present: ${needed}`,
          "missing — transformer/security mapping needs review",
        );
      }
    }
    if (columnNames.has("business_unit")) {
      fail(
        "column absent: business_unit",
        "unexpectedly present — model may need the axis back",
      );
    } else {
      pass("column absent: business_unit", "model axis correctly removed");
    }

    // 3. Row count.
    try {
      const res = await db.query(
        `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.${TABLE}`,
      );
      const count = (res.rows[0] as { count: number }).count;
      pass("row count", `${count} rows`);
    } catch (error) {
      fail("row count", String(error));
    }

    // 4. Sample rows (what the indexer will actually see via SELECT *).
    try {
      const res = await db.query(
        `SELECT * FROM ${SCHEMA}.${TABLE} LIMIT 3`,
      );
      logBlock(
        "sample rows (keys the transformer reads)",
        (res.rows as Record<string, unknown>[]).map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v,
            ]),
          ),
        ),
      );
      pass("sample rows", `${res.rows.length} row(s) shown`);
    } catch (error) {
      fail("sample rows", String(error));
    }
  } finally {
    await db.close();
  }

  // 5. Real axis.query() end-to-end (open mode — no JWT, no RLS context).
  const ctx = createApp(config.databaseUrl, { cacheEnabled: false });
  try {
    const result = await ctx.axis.query({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      limit: 5,
    });
    logBlock("axis.query() rows", result.rows);
    pass("axis.query()", `rowCount=${result.rowCount}`);
  } catch (error) {
    fail("axis.query()", error instanceof Error ? error.message : String(error));
  } finally {
    await ctx.axis.close();
  }

  console.log(
    failures === 0 ? "\nAll PostgreSQL checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
