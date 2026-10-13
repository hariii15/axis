import "dotenv/config";
import { createApp } from "./src/app.js";
import { config } from "./src/config.js";

async function main(): Promise<void> {
  const ctx = createApp(config.databaseUrl, {
    jwtSecret: config.jwtSecret,
    opensearchUrl: config.opensearchUrl,
  });
  const C = { user: "alice@example.com", tenant: "tenant-001", roles: ["M"] };
  try {
    const r1 = await ctx.axis.searchDocuments(
      { model: "Companies", metrics: ["totalCompanies"] },
      { context: C },
    );
    console.log("count:", JSON.stringify(r1));

    const r2 = await ctx.axis.searchDocuments(
      {
        model: "Companies",
        axes: ["msmeClassification"],
        metrics: ["totalCompanies", "turnoverTotal"],
        orderBy: [{ field: "msmeClassification", direction: "asc" }],
        limit: 10,
      },
      { context: C },
    );
    console.log("grouped:", JSON.stringify(r2));

    const r3 = await ctx.axis.searchDocuments(
      {
        model: "Companies",
        search: { type: "fulltext", text: "Apex" },
        limit: 5,
      },
      { context: C },
    );
    console.log("fulltext ids:", JSON.stringify(r3.rows.map((r) => (r as Record<string, unknown>)._id)));

    const r4 = await ctx.axis.searchDocuments(
      {
        model: "Companies",
        metrics: ["totalCompanies"],
        filters: [{ field: "turnover2526", operator: "greaterThan", value: 100000000 }],
      },
      { context: C },
    );
    console.log("filtered count:", JSON.stringify(r4));

    // foreign tenant sees the SAME shared data (no isolation on catalog)
    const r5 = await ctx.axis.searchDocuments(
      { model: "Companies", metrics: ["msmeCount"] },
      { context: { user: "x@y.com", tenant: "other-tenant", roles: [] } },
    );
    console.log("other-tenant msme:", JSON.stringify(r5));
  } finally {
    await ctx.axis.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
