/**
 * Seed the `po` database with sample requisitions (re-runnable).
 *
 * Creates upeg.requisition_deails (same shape as the purchase DB)
 * and inserts sample rows across departments / statuses / tenants.
 *
 * Usage:
 *   npx tsx scripts/seed-po.ts
 */
import "dotenv/config";
import { Database } from "axis";
import { config } from "../src/config.js";

const ROWS: Array<[string, string, number, string, number, string, string]> = [
  // id, department, status, created_by, amount, created_date, tenant
  ["REQ-PO-001", "Engineering", 1, "alice@example.com", 12000, "2026-09-01T10:00:00Z", "tenant-001"],
  ["REQ-PO-002", "Engineering", 2, "bob@example.com", 45000, "2026-09-02T11:00:00Z", "tenant-001"],
  ["REQ-PO-003", "Procurement", 1, "alice@example.com", 8000, "2026-09-03T09:30:00Z", "tenant-001"],
  ["REQ-PO-004", "Procurement", 2, "carol@example.com", 22000, "2026-09-04T14:00:00Z", "tenant-001"],
  ["REQ-PO-005", "Facilities", 1, "bob@example.com", 3000, "2026-09-05T08:00:00Z", "tenant-001"],
  ["REQ-PO-006", "Chemical", 2, "alice@example.com", 67000, "2026-09-06T16:00:00Z", "tenant-001"],
  ["REQ-PO-007", "Engineering", 1, "dave@example.com", 15000, "2026-09-07T10:00:00Z", "tenant-002"],
  ["REQ-PO-008", "Logistics", 2, "dave@example.com", 9000, "2026-09-08T12:00:00Z", "tenant-002"],
];

async function main() {
  const db = new Database({ url: config.databaseUrl });
  try {
    await db.testConnection();
    await db.query(`CREATE SCHEMA IF NOT EXISTS upeg`);
    await db.query(`CREATE TABLE IF NOT EXISTS upeg.requisition_deails (
      requisition_id varchar NOT NULL PRIMARY KEY,
      department_name varchar NOT NULL,
      status integer NOT NULL,
      created_by varchar NULL,
      amount numeric NULL,
      created_date timestamptz NULL,
      tenant_id varchar NULL
    )`);
    console.log("table ready: upeg.requisition_deails");

    let inserted = 0;
    for (const [id, dept, status, by, amount, date, tenant] of ROWS) {
      const res = await db.query(
        `INSERT INTO upeg.requisition_deails
           (requisition_id, department_name, status, created_by, amount, created_date, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (requisition_id) DO NOTHING`,
        [id, dept, status, by, amount, date, tenant],
      );
      inserted += res.rowCount ?? 0;
    }
    console.log(`seeded: ${inserted} new rows (${ROWS.length} total defined)`);

    const count = await db.query(
      `SELECT tenant_id AS tenant, COUNT(*)::int AS n
         FROM upeg.requisition_deails GROUP BY 1 ORDER BY 1`,
    );
    console.log("rows per tenant:", JSON.stringify(count.rows));
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
