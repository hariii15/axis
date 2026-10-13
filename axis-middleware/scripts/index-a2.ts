/**
 * Index Architecture A2 models into OpenSearch (re-runnable).
 *
 * For each of CompanyInfo / ContactInfo / FinancialInfo:
 *   1. (Re)creates the index from its canonical mapping JSON
 *      (scripts/<model>.mapping.json) — DELETE then PUT.
 *   2. Runs axis.index(model) — PG table → transform → embed → bulk.
 *   3. Refreshes the index so reads are immediately consistent.
 *
 * Usage:
 *   npx tsx scripts/index-a2.ts
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const MODELS = [
  { model: "CompanyInfo", index: "companyinfo", mapping: "scripts/company-info.mapping.json" },
  { model: "ContactInfo", index: "contactinfo", mapping: "scripts/contact-info.mapping.json" },
  { model: "FinancialInfo", index: "financialinfo", mapping: "scripts/financial-info.mapping.json" },
] as const;

async function recreateIndex(base: string, index: string, mappingPath: string) {
  const raw = await readFile(mappingPath, "utf8");
  const body = JSON.parse(raw) as Record<string, unknown>;
  delete (body as Record<string, unknown>).comment;

  const del = await fetch(`${base}/${index}`, { method: "DELETE" });
  console.log(`DELETE ${index} -> ${del.status} (404 means fresh, continuing)`);

  const put = await fetch(`${base}/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!put.ok) {
    throw new Error(`PUT ${index} failed: ${put.status} ${await put.text()}`);
  }
  console.log(`PUT ${index} mapping -> ${put.status}`);
}

async function main() {
  const embeddingsReachable = await checkEmbeddings();
  if (!embeddingsReachable) {
    console.warn(
      "WARNING: embedding service unreachable — indexing WITHOUT vectors " +
        "(structured search/filters/aggs unaffected; semantic/hybrid will fail " +
        "until you re-run this script with embeddings up to backfill).",
    );
  }
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
  const base = config.opensearchUrl.replace(/\/+$/, "");
  try {
    for (const { model, index, mapping } of MODELS) {
      await recreateIndex(base, index, mapping);
      const result = await ctx.axis.index(model, {
        ...(embeddingsReachable ? {} : { skipEmbeddings: true }),
      });
      console.log(`indexed ${model}:`, JSON.stringify(result, null, 2));
      if (result.failed > 0) {
        console.error(`failures indexing ${model}:`, JSON.stringify(result.errors.slice(0, 3), null, 2));
        process.exitCode = 1;
        return;
      }
      const refresh = await fetch(`${base}/${index}/_refresh`, { method: "POST" });
      if (!refresh.ok) {
        throw new Error(`refresh failed for ${index}: ${refresh.status} ${await refresh.text()}`);
      }
      console.log(`index refreshed: ${index}`);
    }
  } finally {
    await ctx.axis.close();
  }
}

async function checkEmbeddings(): Promise<boolean> {
  const base = config.embeddingUrl;
  if (!base || !config.embeddingModel) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${base.replace(/\/+$/, "")}/health`, {
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
