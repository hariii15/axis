/**
 * OpenSearch connectivity check for Axis.
 *
 * Exercises exactly the operations Axis uses:
 *   1. Base HTTP reachability (GET /)
 *   2. Cluster health (adapter.healthCheck → cluster.health)
 *   3. Index a test doc (adapter.index)
 *   4. Search it back (adapter.search — match query)
 *   5. k-NN plugin presence (informational, needed for Phase 9 vectors)
 *   6. Cleanup (delete the test index)
 *
 * Usage:
 *   npx tsx scripts/check-opensearch.ts
 *
 * Reads OPENSEARCH_URL (+ OPENSEARCH_USERNAME/PASSWORD) from .env.
 * Exits 0 when all required checks pass, 1 otherwise.
 */
import "dotenv/config";
import { OpenSearchAdapter } from "axis";

const url = process.env.OPENSEARCH_URL ?? "";
if (!url) {
  console.error("FAIL: OPENSEARCH_URL is not set in .env");
  process.exit(1);
}

const TEST_INDEX = "axis-connectivity-check";
const TEST_ID = "check-1";

let failures = 0;

function pass(step: string, detail = "") {
  console.log(`PASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, detail = "") {
  failures += 1;
  console.error(`FAIL: ${step}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`OpenSearch URL: ${url}\n`);

  // 1. Base HTTP reachability.
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()) as { version?: { number?: string } };
    pass("base HTTP reachability", `version ${info.version?.number ?? "unknown"}`);
  } catch (error) {
    fail("base HTTP reachability", String(error));
    console.error("\nOpenSearch is unreachable — skipping remaining checks.");
    process.exit(1);
  }

  const adapter = new OpenSearchAdapter({
    url,
    ...(process.env.OPENSEARCH_USERNAME && process.env.OPENSEARCH_PASSWORD
      ? {
          username: process.env.OPENSEARCH_USERNAME,
          password: process.env.OPENSEARCH_PASSWORD,
        }
      : {}),
  });

  try {
    // 2. Cluster health via the adapter (same call Axis uses).
    try {
      const healthy = await adapter.healthCheck();
      if (healthy) {
        pass("cluster health (adapter.healthCheck)");
      } else {
        fail("cluster health (adapter.healthCheck)", "cluster status is red");
      }
    } catch (error) {
      fail("cluster health (adapter.healthCheck)", String(error));
    }

    // 3. Index a test doc via the adapter.
    try {
      const result = await adapter.index({
        index: TEST_INDEX,
        id: TEST_ID,
        document: { title: "connectivity check", tenant_id: "check" },
        refresh: true,
      });
      pass("index document (adapter.index)", `result=${result.result}`);
    } catch (error) {
      fail("index document (adapter.index)", String(error));
    }

    // 4. Search it back via the adapter.
    try {
      const result = await adapter.search({
        index: TEST_INDEX,
        query: { match: { title: { query: "connectivity" } } },
        size: 5,
      });
      const found = result.hits.some((h) => h._id === TEST_ID);
      if (found) {
        pass(
          "search document (adapter.search)",
          `hits=${result.hits.length}, total=${JSON.stringify(result.total)}`,
        );
      } else {
        fail(
          "search document (adapter.search)",
          `test doc not in ${result.hits.length} hit(s)`,
        );
      }
    } catch (error) {
      fail("search document (adapter.search)", String(error));
    }

    // 5. k-NN plugin presence (needed later for vector search — informational).
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/_cat/plugins?format=json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const plugins = (await res.json()) as Array<{ component?: string }>;
      const hasKnn = plugins.some((p) =>
        (p.component ?? "").toLowerCase().includes("knn"),
      );
      if (hasKnn) {
        pass("k-NN plugin present (needed for Phase 9 vector search)");
      } else {
        console.log(
          "WARN: k-NN plugin not listed — install opensearch-knn before indexing vectors.",
        );
      }
    } catch (error) {
      console.log(`WARN: could not list plugins — ${String(error)}`);
    }
  } finally {
    // 6. Cleanup.
    try {
      await adapter.deleteIndex(TEST_INDEX);
      pass("cleanup (delete test index)");
    } catch (error) {
      fail("cleanup (delete test index)", String(error));
    }
    await adapter.close();
  }

  console.log(failures === 0 ? "\nAll required checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
