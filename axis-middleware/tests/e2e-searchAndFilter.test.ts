import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildOpenSearchSecurityFilters,
  debugCompileToOpenSearch,
  type AxisContext,
} from "axis";

import { createApp, type AppContext } from "../src/app.js";
import { config } from "../src/config.js";

// ---------------------------------------------------------------------------
// E2E: DB rows -> index -> filter/search through OpenSearch.
// ---------------------------------------------------------------------------
// LIVE test - needs PostgreSQL (localhost), OpenSearch + embeddings
// (see .env). The whole suite SKIPS gracefully when the laptop
// containers are unreachable, so plain `npm run test` stays green
// offline. Run it explicitly with:
//
//   npx vitest run tests/e2e-searchAndFilter.test.ts
//
// What it does:
//   1. asserts the 8 seeded rows exist in the po database
//      (run `npx tsx scripts/seed-po.ts` first if this fails)
//   2. indexes them via axis.index() and logs the result
//   3. dumps every indexed document to src/reference/indexed-docs.txt
//   4. runs the filter/search matrix, logging input -> DSL -> rows
// ---------------------------------------------------------------------------

const MODEL = "PurchaseRequisitions";
const REFERENCE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "reference",
  "indexed-docs.txt",
);

const T1 = { tenant: "tenant-001", user: "alice@example.com", roles: [] };
const T2 = { tenant: "tenant-002", user: "dave@example.com", roles: [] };
const TIMEOUT = 120_000;

async function reachable(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

const LIVE = await (async () => {
  if (!config.opensearchUrl || !config.embeddingUrl) return false;
  const [os, emb] = await Promise.all([
    reachable(config.opensearchUrl),
    reachable(`${config.embeddingUrl.replace(/\/+$/, "")}/health`),
  ]);
  return os && emb;
})();

if (!LIVE) {
  console.log(
    "SKIP e2e-searchAndFilter: OpenSearch/embedding containers unreachable " +
      `(OPENSEARCH_URL=${config.opensearchUrl || "(unset)"}).`,
  );
}

describe.skipIf(!LIVE)("e2e search + filter pipeline", () => {
  let ctx: AppContext;

  beforeAll(() => {
    ctx = createApp(config.databaseUrl, {
      cacheEnabled: false,
      opensearchUrl: config.opensearchUrl,
      embeddingUrl: config.embeddingUrl,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      embeddingApiKey: config.embeddingApiKey || undefined,
      jwtSecret: "e2e-check",
    });
  });

  afterAll(async () => {
    await ctx.axis.close();
  });

  it(
    "seeded rows exist in the database",
    async () => {
      const { Database } = await import("axis");
      const db = new Database({ url: config.databaseUrl });
      try {
        const res = await db.query(
          "SELECT COUNT(*)::int AS n FROM upeg.requisition_deails",
        );
        const n = (res.rows[0] as { n: number }).n;
        console.log(`\n[DATA STATE] upeg.requisition_deails: ${n} rows`);
        expect(n, "run `npx tsx scripts/seed-po.ts` to seed the po database").toBe(8);
      } finally {
        await db.close();
      }
    },
    TIMEOUT,
  );

  it(
    "indexes every row into OpenSearch",
    async () => {
      const result = await ctx.axis.index(MODEL);
      console.log("\n[FLOW] axis.index() result:", JSON.stringify(result, null, 2));
      expect(result.failed).toBe(0);
      expect(result.indexed).toBe(8);

      // Force refresh: writes default to refresh=false, and the suite
      // must not depend on the 1s background refresh interval.
      const base = config.opensearchUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/purchase-requisitions/_refresh`, {
        method: "POST",
      });
      expect(res.ok).toBe(true);
      console.log("[FLOW] index refreshed");
    },
    TIMEOUT,
  );

  it(
    "dumps indexed documents to src/reference/indexed-docs.txt",
    async () => {
      const adapter = ctx.axis.search;
      expect(adapter, "search adapter not wired").toBeDefined();
      const found = await adapter!.search({
        index: "purchase-requisitions",
        query: { matchAll: {} },
        size: 100,
      });
      const total =
        typeof found.total === "number" ? found.total : found.total.value;
      console.log(`\n[DATA STATE] purchase-requisitions index: ${total} docs`);
      expect(total).toBeGreaterThanOrEqual(8);

      // Reference snapshot covers only this suite's rows (other demo
      // docs may share the index).
      const docs = [...found.hits]
        .filter((h) => h._id.startsWith("REQ-PO-"))
        .sort((a, b) => (a._id < b._id ? -1 : 1))
        .map((h) => ({ _id: h._id, ...h._source }));
      expect(docs).toHaveLength(8);
      mkdirSync(dirname(REFERENCE_FILE), { recursive: true });
      writeFileSync(REFERENCE_FILE, `${JSON.stringify(docs, null, 2)}\n`);
      console.log(`[REFERENCE] wrote ${docs.length} docs to ${REFERENCE_FILE}`);
    },
    TIMEOUT,
  );

  it("logs the full compile pipeline for a filtered search", () => {
    const model = ctx.registry.get(MODEL);
    // Prints INPUT -> validated query -> AST -> resolved -> OpenSearch DSL.
    debugCompileToOpenSearch(
      {
        model: MODEL,
        metrics: ["newCount"],
        filters: [{ field: "status", operator: "equals", value: 1 }],
        search: { type: "fulltext", text: "Engineering" },
        limit: 5,
      },
      model,
    );

    // Same DSL with tenant security filters applied.
    const securityFilters = buildOpenSearchSecurityFilters(T1 as AxisContext, {
      mappings: {
        tenant: {
          contextKey: "tenant",
          column: "tenant_id",
          sessionKey: "app.tenant_id",
          required: true,
        },
        user: {
          contextKey: "user",
          column: "created_by",
          sessionKey: "app.user_id",
          required: true,
          searchField: "createdBy",
        },
      },
    });
    console.log(
      "\n[FLOW] security filters for tenant-001/alice:",
      JSON.stringify(securityFilters),
    );
    expect(securityFilters).toContainEqual({ term: { tenant_id: "tenant-001" } });
  });

  it(
    "metric agg status=1 (alice): single row { newCount: 2 }",
    async () => {
      const input = {
        model: MODEL,
        metrics: ["newCount"],
        filters: [{ field: "status", operator: "equals", value: 1 }],
        limit: 10,
      };
      console.log("\n[FLOW] input:", JSON.stringify(input));
      const r = await ctx.axis.searchDocuments(input, { context: T1 });
      console.log("[FLOW] rows:", JSON.stringify(r.rows), `rowCount=${r.rowCount}`);
      // alice owns 001 + 003 with status 1 (005 is bob's).
      expect(r.rows).toEqual([{ newCount: 2 }]);
      expect(r.rowCount).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "metric agg department=Procurement (alice): { newCount: 1 }",
    async () => {
      const input = {
        model: MODEL,
        metrics: ["newCount"],
        filters: [{ field: "department", operator: "equals", value: "Procurement" }],
        limit: 10,
      };
      console.log("\n[FLOW] input:", JSON.stringify(input));
      const r = await ctx.axis.searchDocuments(input, { context: T1 });
      console.log("[FLOW] rows:", JSON.stringify(r.rows));
      // Only 003 is alice's (004 is carol's).
      expect(r.rows).toEqual([{ newCount: 1 }]);
    },
    TIMEOUT,
  );

  it(
    "metric agg status=2 AND department=Chemical (alice): { newCount: 1 }",
    async () => {
      const r = await ctx.axis.searchDocuments(
        {
          model: MODEL,
          metrics: ["newCount"],
          filters: [
            { field: "status", operator: "equals", value: 2 },
            { field: "department", operator: "equals", value: "Chemical" },
          ],
          limit: 10,
        },
        { context: T1 },
      );
      console.log("\n[FLOW] combined AND rows:", JSON.stringify(r.rows));
      expect(r.rows).toEqual([{ newCount: 1 }]);
    },
    TIMEOUT,
  );

  it(
    "metric agg tenant isolation: tenant-002 counts only its 2 rows",
    async () => {
      const r = await ctx.axis.searchDocuments(
        { model: MODEL, metrics: ["newCount"], limit: 10 },
        { context: T2 },
      );
      console.log("\n[FLOW] tenant-002 rows:", JSON.stringify(r.rows));
      expect(r.rows).toEqual([{ newCount: 2 }]);
    },
    TIMEOUT,
  );

  it(
    "unknown tenant counts zero (fail-closed, nothing leaks)",
    async () => {
      const r = await ctx.axis.searchDocuments(
        { model: MODEL, metrics: ["newCount"], limit: 10 },
        {
          context: { tenant: "tenant-999", user: "x@example.com", roles: [] },
        },
      );
      console.log("\n[FLOW] tenant-999 rows:", JSON.stringify(r.rows));
      expect(r.rows).toEqual([{ newCount: 0 }]);
    },
    TIMEOUT,
  );

  it(
    "grouped agg axes+metrics (alice): one row per department",
    async () => {
      const r = await ctx.axis.searchDocuments(
        {
          model: MODEL,
          axes: ["department"],
          metrics: ["newCount"],
          orderBy: [{ field: "department", direction: "asc" }],
          limit: 10,
          offset: 0,
        },
        { context: T1 },
      );
      console.log("\n[FLOW] grouped rows:", JSON.stringify(r.rows));
      // alice owns 001 (Engineering), 003 (Procurement), 006 (Chemical).
      expect(r.rows).toEqual([
        { department: "Chemical", newCount: 1 },
        { department: "Engineering", newCount: 1 },
        { department: "Procurement", newCount: 1 },
      ]);
      expect(r.rowCount).toBe(3);
    },
    TIMEOUT,
  );

  it(
    "fulltext Engineering + status=1 (tenant-001): REQ-PO-001",
    async () => {
      const input = {
        model: MODEL,
        search: { type: "fulltext", text: "Engineering" },
        filters: [{ field: "status", operator: "equals", value: 1 }],
        limit: 10,
      };
      console.log("\n[FLOW] input:", JSON.stringify(input));
      const r = await ctx.axis.searchDocuments(input, { context: T1 });
      const ids = idsOf(r.rows);
      console.log("[FLOW] rows:", JSON.stringify(ids));
      expect(ids).toEqual(["REQ-PO-001"]);
    },
    TIMEOUT,
  );

  it(
    "document sort, no metrics: alice's rows ordered by department",
    async () => {
      const r = await ctx.axis.searchDocuments(
        {
          model: MODEL,
          axes: ["department"],
          orderBy: [{ field: "department", direction: "asc" }],
          limit: 10,
          offset: 0,
        },
        { context: T1 },
      );
      const departments = (r.rows as Record<string, unknown>[]).map(
        (row) => row["department"],
      );
      console.log("\n[FLOW] sorted departments:", JSON.stringify(departments));
      // alice owns 001 (Engineering), 003 (Procurement), 006 (Chemical).
      expect(departments).toEqual(["Chemical", "Engineering", "Procurement"]);
    },
    TIMEOUT,
  );

  it(
    "range filter amount > 20000 (alice): { newCount: 1 }",
    async () => {
      const r = await ctx.axis.searchDocuments(
        {
          model: MODEL,
          metrics: ["newCount"],
          filters: [{ field: "amount", operator: "greaterThan", value: 20000 }],
          limit: 10,
        },
        { context: T1 },
      );
      console.log("\n[FLOW] amount>20000 rows:", JSON.stringify(r.rows));
      // Above 20000: 002 (bob), 004 (carol), 006 (alice) — only 006 is alice's.
      expect(r.rows).toEqual([{ newCount: 1 }]);
    },
    TIMEOUT,
  );
});

function idsOf(rows: Record<string, unknown>[] | unknown[]): string[] {
  return (rows as Record<string, unknown>[])
    .map((row) => row["_id"])
    .filter((id): id is string => typeof id === "string")
    .sort();
}
