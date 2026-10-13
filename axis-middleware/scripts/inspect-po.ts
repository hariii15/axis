import "dotenv/config";
import { Database } from "axis";
import { config } from "../src/config.js";

const db = new Database({ url: config.databaseUrl });
try {
  await db.testConnection();
  console.log("connected:", config.databaseUrl.replace(/:[^:@]+@/, ":***@"));

  const tables = await db.query(
    `SELECT schemaname || '.' || tablename AS t
       FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY 1`,
  );
  console.log("tables:", JSON.stringify(tables.rows));

  for (const row of tables.rows as Array<{ t: string }>) {
    const [schema, table] = row.t.split(".");
    try {
      const c = await db.query(
        `SELECT COUNT(*)::int AS n FROM ${schema}.${table}`,
      );
      console.log(`${row.t}: ${(c.rows[0] as { n: number }).n} rows`);
    } catch (e) {
      console.log(`${row.t}: count failed (${String(e).slice(0, 120)})`);
    }
  }

  try {
    const cols = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'upeg' AND table_name = 'requisition_deails'
        ORDER BY ordinal_position`,
    );
    console.log("upeg.requisition_deails columns:", JSON.stringify(cols.rows));
  } catch (e) {
    console.log("upeg.requisition_deails missing:", String(e).slice(0, 150));
  }
} finally {
  await db.close();
}
