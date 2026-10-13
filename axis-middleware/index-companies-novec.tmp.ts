import "dotenv/config";
import { Database, DefaultDocumentTransformer } from "axis";
import { Companies } from "./src/models/companies.js";
import { createApp } from "./src/app.js";
import { config } from "./src/config.js";

// TEMPORARY: index vendor docs WITHOUT vectors (embeddings container down).
// Run scripts/index-companies.ts once :8000 is back to backfill vectors
// (same IDs → in-place update; mapping already declares knn_vector).
async function main(): Promise<void> {
  const ctx = createApp(config.databaseUrl, {
    opensearchUrl: config.opensearchUrl,
  });
  const adapter = ctx.axis.search;
  if (adapter === undefined) throw new Error("no search adapter");
  const db = new Database({ url: config.databaseUrl });
  try {
    const rows = await db.query("SELECT * FROM vendor_companies");
    const transformer = new DefaultDocumentTransformer(Companies);
    let ok = 0;
    const errors: unknown[] = [];
    for (const row of rows.rows as Record<string, unknown>[]) {
      try {
        const doc = await transformer.transform(row);
        const body: Record<string, unknown> = { ...doc.fields };
        if (doc.tenantId !== undefined) body.tenant_id = doc.tenantId;
        if (doc.searchableText !== undefined) body.searchable_text = doc.searchableText;
        await adapter.index({ index: "companies", id: doc.id, document: body });
        ok += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    console.log(`indexed ${ok}/${rows.rows.length}, errors: ${errors.length}`);
    if (errors.length > 0) {
      console.log(JSON.stringify(errors.slice(0, 5)));
      process.exitCode = 1;
    }
    const base = config.opensearchUrl.replace(/\/+$/, "");
    await fetch(`${base}/companies/_refresh`, { method: "POST" });
    console.log("refreshed");
  } finally {
    await db.close();
    await ctx.axis.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
