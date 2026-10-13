/**
 * Structured search check: filtering + fulltext through OpenSearch.
 * No embeddings needed at query time (semantic skipped for now).
 *
 * Flow: axis.index() (PG → OpenSearch) then a matrix of
 * searchDocuments() assertions with per-step logging.
 *
 * Usage:
 *   npx tsx scripts/check-structured-search.ts
 *
 * Exits 0 when all checks pass, 1 otherwise.
 */
import "dotenv/config";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let failures = 0;
let step = 0;

function check(name: string, actual: unknown, expected: unknown) {
  step += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS [${step}]: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL [${step}]: ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function logBlock(title: string, value: unknown) {
  console.log(`\n----- ${title} -----\n${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const ctx = createApp(config.databaseUrl, {
    cacheEnabled: false,
    opensearchUrl: config.opensearchUrl,
    embeddingUrl: config.embeddingUrl,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingApiKey: config.embeddingApiKey || undefined,
    jwtSecret: "check",
  });
  const { axis } = ctx;

  const T1 = { tenant: "tenant-001", user: "alice@example.com", roles: [] as string[] };
  const T2 = { tenant: "tenant-002", user: "dave@example.com", roles: [] as string[] };

  try {
    // 0. Index from the po database.
    const result = await axis.index("PurchaseRequisitions");
    logBlock("axis.index() result", result);
    check("indexed 8 rows", result.indexed, 8);
    check("no failures", result.failed, 0);

    const ids = async (input: unknown, context?: unknown) => {
      const r = await axis.searchDocuments(
        input,
        context === undefined ? undefined : { context: context as Record<string, unknown> },
      );
      return (r.rows as Record<string, unknown>[])
        .map((row) => row["_id"])
        .sort();
    };

    // 1. Fulltext match (no security context → open DSL, tenant filter absent).
    logBlock(
      "fulltext 'Engineering'",
      await axis.searchDocuments({
        model: "PurchaseRequisitions",
        search: { type: "fulltext", text: "Engineering" },
        limit: 10,
      }),
    );

    // 2. Term filter: status = 1 (tenant-001).
    check(
      "filter status=1 (tenant-001)",
      await ids(
        {
          model: "PurchaseRequisitions",
          metrics: ["newCount"],
          filters: [{ field: "status", operator: "equals", value: 1 }],
          limit: 10,
        },
        T1,
      ),
      ["REQ-PO-001", "REQ-PO-003", "REQ-PO-005"],
    );

    // 3. Term filter: department = Procurement (tenant-001).
    check(
      "filter department=Procurement (tenant-001)",
      await ids(
        {
          model: "PurchaseRequisitions",
          metrics: ["newCount"],
          filters: [{ field: "department", operator: "equals", value: "Procurement" }],
          limit: 10,
        },
        T1,
      ),
      ["REQ-PO-003", "REQ-PO-004"],
    );

    // 4. Combined filters AND.
    check(
      "status=2 AND department=Engineering (tenant-001)",
      await ids(
        {
          model: "PurchaseRequisitions",
          metrics: ["newCount"],
          filters: [
            { field: "status", operator: "equals", value: 2 },
            { field: "department", operator: "equals", value: "Engineering" },
          ],
          limit: 10,
        },
        T1,
      ),
      ["REQ-PO-002"],
    );

    // 5. Tenant isolation: tenant-002 sees only its own rows.
    check(
      "tenant isolation (tenant-002)",
      await ids(
        {
          model: "PurchaseRequisitions",
          metrics: ["newCount"],
          limit: 10,
        },
        T2,
      ),
      ["REQ-PO-007", "REQ-PO-008"],
    );

    // 6. Fulltext + filter combined.
    check(
      "fulltext 'Engineering' + status=1 (tenant-001)",
      await ids(
        {
          model: "PurchaseRequisitions",
          search: { type: "fulltext", text: "Engineering" },
          filters: [{ field: "status", operator: "equals", value: 1 }],
          limit: 10,
        },
        T1,
      ),
      ["REQ-PO-001"],
    );

    // 7. Sorting + pagination.
    const sorted = await axis.searchDocuments(
      {
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
        orderBy: [{ field: "department", direction: "asc" }],
        limit: 3,
        offset: 0,
      },
      { context: T1 },
    );
    check(
      "sort + limit (first 3 departments asc, tenant-001)",
      (sorted.rows as Record<string, unknown>[]).map((r) => r["department"]),
      ["Chemical", "Engineering", "Engineering"],
    );
  } finally {
    await ctx.axis.close();
  }

  console.log(
    failures === 0
      ? `\nAll structured search checks passed (${step} steps).`
      : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
