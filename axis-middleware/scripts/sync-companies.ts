/**
 * Synchronize vendor_companies (Postgres) with the companies index (OpenSearch).
 *
 * Compares row count vs indexed doc count and reindexes when they differ
 * (same IDs update in place; new IDs get created). Full reindex is cheap
 * at this scale and is the honest strategy: the vendor tables carry no
 * updated_at column, so incremental `since` syncs cannot detect changes.
 *
 * Vector behavior: axis.index() embeds every doc (fail-closed when the
 * embeddings container is unreachable). With --no-vectors, docs are
 * written without the embedding field instead (filters/aggs/fulltext
 * keep working; semantic search waits for a vectored run).
 *
 * Usage:
 *   npx tsx scripts/sync-companies.ts
 *   npx tsx scripts/sync-companies.ts --force          # reindex even if counts match
 *   npx tsx scripts/sync-companies.ts --no-vectors     # skip embeddings
 *   npx tsx scripts/sync-companies.ts --limit 50       # dry-check first N rows
 */
import "dotenv/config";
import { Database, DefaultDocumentTransformer, type SearchAdapter } from "axis";
import { Companies } from "../src/models/companies.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const MODEL = "Companies";
const INDEX = "companies";

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function intFlag(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

async function indexCount(search: SearchAdapter): Promise<number> {
  const res = await search.search({ index: INDEX, query: { matchAll: {} }, size: 0 });
  return typeof res.total === "number" ? res.total : res.total.value;
}

async function main() {
  const force = flag("--force");
  const noVectors = flag("--no-vectors");
  const limit = intFlag("--limit");

  const ctx = createApp(config.databaseUrl, {
    jwtSecret: config.jwtSecret,
    opensearchUrl: config.opensearchUrl,
    opensearchUsername: config.opensearchUsername || undefined,
    opensearchPassword: config.opensearchPassword || undefined,
    opensearchIndexPrefix: config.opensearchIndexPrefix || undefined,
    embeddingUrl: noVectors ? "" : config.embeddingUrl,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingApiKey: config.embeddingApiKey || undefined,
    embeddingDimensions: config.embeddingDimensions,
  });
  const adapter = ctx.axis.search;
  if (adapter === undefined) {
    throw new Error("search adapter not configured (OPENSEARCH_URL).");
  }
  const db = new Database({ url: config.databaseUrl });
  try {
    const dbRes = await db.query(
      limit !== undefined
        ? "SELECT COUNT(*)::int AS n FROM (SELECT * FROM vendor_companies LIMIT $1) s"
        : "SELECT COUNT(*)::int AS n FROM vendor_companies",
      limit !== undefined ? [limit] : [],
    );
    const dbCount = (dbRes.rows[0] as { n: number }).n;
    const osCount = await indexCount(adapter);
    console.log(`db rows: ${dbCount}, indexed docs: ${osCount}`);

    if (!force && dbCount === osCount) {
      console.log("in sync — nothing to do.");
      return;
    }

    if (noVectors) {
      console.log("indexing WITHOUT vectors (embeddings skipped)...");
      const rows = await db.query(
        limit !== undefined
          ? "SELECT * FROM vendor_companies LIMIT $1"
          : "SELECT * FROM vendor_companies",
        limit !== undefined ? [limit] : [],
      );
      const transformer = new DefaultDocumentTransformer(Companies);
      let ok = 0;
      const errors: string[] = [];
      for (const row of rows.rows as Record<string, unknown>[]) {
        try {
          const doc = await transformer.transform(row);
          const body: Record<string, unknown> = { ...doc.fields };
          if (doc.tenantId !== undefined) body.tenant_id = doc.tenantId;
          if (doc.searchableText !== undefined) {
            body.searchable_text = doc.searchableText;
          }
          await adapter.index({ index: INDEX, id: doc.id, document: body });
          ok += 1;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      console.log(`indexed ${ok}/${rows.rows.length}, errors: ${errors.length}`);
      if (errors.length > 0) {
        console.log(JSON.stringify(errors.slice(0, 5), null, 2));
        process.exitCode = 1;
        return;
      }
    } else {
      console.log("indexing WITH vectors via axis.index()...");
      const result = await ctx.axis.index(
        MODEL,
        limit !== undefined ? { limit } : {},
      );
      console.log(JSON.stringify(result, null, 2));
      if (result.failed > 0) {
        process.exitCode = 1;
        return;
      }
    }

    const base = config.opensearchUrl.replace(/\/+$/, "");
    const refresh = await fetch(`${base}/${INDEX}/_refresh`, { method: "POST" });
    if (!refresh.ok) {
      throw new Error(`refresh failed: ${refresh.status}`);
    }
    const after = await indexCount(adapter);
    console.log(`done. indexed docs now: ${after} (db: ${dbCount})`);
    if (after !== dbCount && limit === undefined) {
      console.log("WARNING: counts still differ — investigate failures above.");
      process.exitCode = 1;
    }
  } finally {
    await db.close();
    await ctx.axis.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
