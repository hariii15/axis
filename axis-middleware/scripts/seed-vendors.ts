/**
 * Verify the vendor data + `vendor_companies` view (re-runnable, read-only).
 *
 * The source tables, data (30 vendors), and the flat view already exist —
 * this script only verifies counts so indexing never runs on missing data.
 * Expected view shape: company_info + financial_info + contact_details
 * columns (see inspect output); the view may additionally carry a constant
 * `tenant_id` column, which the model ignores (Companies is a shared
 * catalog — see src/models/companies.ts).
 *
 * Usage:
 *   npx tsx scripts/seed-vendors.ts
 */
import "dotenv/config";
import { Database } from "axis";
import { config } from "../src/config.js";

async function main() {
  const db = new Database({ url: config.databaseUrl });
  try {
    await db.testConnection();
    const counts = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM company_info) AS companies,
         (SELECT COUNT(*)::int FROM financial_info) AS financial,
         (SELECT COUNT(*)::int FROM contact_details) AS contacts,
         (SELECT COUNT(*)::int FROM vendor_companies) AS view_rows`,
    );
    const row = counts.rows[0] as {
      companies: number;
      financial: number;
      contacts: number;
      view_rows: number;
    };
    console.log("counts:", JSON.stringify(row));
    if (
      row.companies !== 30 ||
      row.financial !== 30 ||
      row.contacts !== 30 ||
      row.view_rows !== 30
    ) {
      throw new Error(`expected 30/30/30/30, got ${JSON.stringify(row)}`);
    }
    console.log("vendor data ready: 30 companies");
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
