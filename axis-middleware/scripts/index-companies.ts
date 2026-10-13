/**
 * Index vendor companies into OpenSearch (re-runnable).
 *
 * Builds the app (same wiring as the server: OS adapter + embeddings),
 * runs axis.index("Companies"), and refreshes the index so reads are
 * immediately consistent.
 *
 * Usage:
 *   npx tsx scripts/seed-vendors.ts   # view first
 *   npx tsx scripts/index-companies.ts
 */
import "dotenv/config";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const MODEL = "Companies";
const INDEX = "companies";

async function main() {
  const ctx = createApp(config.databaseUrl, {
    jwtSecret: config.jwtSecret,
    opensearchUrl: config.opensearchUrl,
    opensearchUsername: config.opensearchUsername || undefined,
    opensearchPassword: config.opensearchPassword || undefined,
    opensearchIndexPrefix: config.opensearchIndexPrefix || undefined,
    embeddingUrl: config.embeddingUrl,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingApiKey: config.embeddingApiKey || undefined,
    embeddingDimensions: config.embeddingDimensions,
  });
  try {
    const result = await ctx.axis.index(MODEL);
    console.log(`indexed ${MODEL}:`, JSON.stringify(result, null, 2));
    if (result.failed > 0) {
      process.exitCode = 1;
      return;
    }
    const base = config.opensearchUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/${INDEX}/_refresh`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
    }
    console.log("index refreshed:", INDEX);
  } finally {
    await ctx.axis.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
