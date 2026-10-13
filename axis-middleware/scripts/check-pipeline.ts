/**
 * Whole-pipeline check WITHOUT embeddings.
 *
 * Exercises: validation → AST → resolver → OpenSearch compiler
 * (with security filters) → planner → live OpenSearch round-trip
 * (index → searchDocuments → cache hit → cleanup).
 *
 * Only fulltext/structured search is used — no embedding provider needed.
 *
 * Usage:
 *   npx tsx scripts/check-pipeline.ts
 *
 * Exits 0 when all checks pass, 1 otherwise.
 */
import "dotenv/config";
import {
  buildOpenSearchSecurityFilters,
  compileToOpenSearch,
  debugCompileToOpenSearch,
  ExecutionTarget,
} from "axis";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const TEST_DOC_ID = "axis-pipeline-check-1";
const TEST_WORD = "pipelinetestalpha";

let failures = 0;

function pass(step: string, detail = "") {
  console.log(`PASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, detail = "") {
  failures += 1;
  console.error(`FAIL: ${step}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  if (!config.opensearchUrl) {
    console.error("FAIL: OPENSEARCH_URL is not set in .env");
    process.exit(1);
  }

  // Open mode (no jwtSecret) so the live call needs no JWT;
  // security filters are still demonstrated in the compiled DSL below.
  const ctx = createApp(config.databaseUrl, {
    cacheEnabled: true,
    opensearchUrl: config.opensearchUrl,
    opensearchUsername: config.opensearchUsername || undefined,
    opensearchPassword: config.opensearchPassword || undefined,
    opensearchIndexPrefix: config.opensearchIndexPrefix || undefined,
    opensearchSslRejectUnauthorized: config.opensearchSslRejectUnauthorized,
  });
  const { axis, registry } = ctx;

  try {
    const model = registry.get("PurchaseRequisitions");
    console.log(
      `Model search index: ${model.search?.index ?? "(none — compiler falls back to model name)"}`,
    );

    // 1. Adapter health.
    const healthy = (await axis.search?.healthCheck()) ?? false;
    if (healthy) {
      pass("adapter healthCheck");
    } else {
      fail("adapter healthCheck", "cluster status is red or unreachable");
    }

    // 2. Full compile pipeline with stage logging (no live calls).
    const input = {
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: TEST_WORD },
      filters: [{ field: "department", operator: "equals", value: "Engineering" }],
      limit: 5,
    };
    console.log("\n--- compile pipeline stages ---");
    const { dsl } = debugCompileToOpenSearch(input, model);

    // 3. Security filters land in the DSL (offline, fail-closed semantics).
    const securityFilters = buildOpenSearchSecurityFilters(
      { tenant: "tenant-001", user: "check@example.com" },
      {
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
          },
        },
      },
    );
    const secured = compileToOpenSearch(
      debugCompileToOpenSearch(input, model).resolved,
      { securityFilters },
    );
    const boolFilter = (
      secured.body.query as { bool: { filter?: unknown[] } }
    ).bool.filter;
    const hasTenant = (boolFilter ?? []).some(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        "term" in f &&
        (f as { term: Record<string, unknown> }).term["tenant_id"] === "tenant-001",
    );
    if (hasTenant) {
      pass("security filters in compiled DSL", "term { tenant_id } present");
    } else {
      fail("security filters in compiled DSL", JSON.stringify(secured.body.query));
    }

    // 4. Planner routes fulltext search to OpenSearch.
    const plan = await axis.plan({
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: TEST_WORD },
    });
    if (plan.target === ExecutionTarget.OPENSEARCH) {
      pass("planner routes fulltext → opensearch", plan.reason);
    } else {
      fail("planner routes fulltext → opensearch", `got ${plan.target}`);
    }

    // 5. Live round-trip: index → searchDocuments → cache hit.
    // NOTE: fulltext-only input here. Structured `term` filters need
    // keyword mappings (tomorrow's mapping work) — dynamic mapping
    // analyzes text fields, so `term` can't match until then.
    // The term-filter DSL is already proven in the offline stages above.
    const liveInput = {
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: TEST_WORD },
      limit: 5,
    };
    const adapter = axis.search;
    if (!adapter) {
      fail("live round-trip", "no search adapter");
    } else {
      await adapter.index({
        index: model.search?.index ?? model.name,
        id: TEST_DOC_ID,
        document: {
          department: `Connectivity ${TEST_WORD}`,
        },
        refresh: true,
      });
      pass("live index document");

      // Wrap adapter.search to count live calls (cache verification).
      let liveCalls = 0;
      const originalSearch = adapter.search.bind(adapter);
      adapter.search = (async (...args: Parameters<typeof originalSearch>) => {
        liveCalls += 1;
        return originalSearch(...args);
      }) as typeof originalSearch;

      const first = await axis.searchDocuments(liveInput);
      const found = first.rows.some(
        (r) => (r as Record<string, unknown>)._id === TEST_DOC_ID,
      );
      if (found) {
        pass("live searchDocuments round-trip", `rowCount=${first.rowCount}`);
      } else {
        fail(
          "live searchDocuments round-trip",
          `test doc missing from ${first.rows.length} row(s)`,
        );
      }

      await axis.searchDocuments(liveInput);
      if (liveCalls === 1) {
        pass("repeat search served from cache (no 2nd live call)");
      } else {
        fail("repeat search served from cache", `liveCalls=${liveCalls}`);
      }

      // 6. Cleanup: delete only our test doc (never the index).
      try {
        const base = config.opensearchUrl.replace(/\/+$/, "");
        const index = model.search?.index ?? model.name;
        const res = await fetch(
          `${base}/${index}/_doc/${TEST_DOC_ID}?refresh=true`,
          { method: "DELETE" },
        );
        if (res.ok) {
          pass("cleanup (delete test doc)");
        } else {
          fail("cleanup (delete test doc)", `HTTP ${res.status}`);
        }
      } catch (error) {
        fail("cleanup (delete test doc)", String(error));
      }
    }

    void dsl;
  } finally {
    await ctx.axis.close();
  }

  console.log(
    failures === 0 ? "\nAll pipeline checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
