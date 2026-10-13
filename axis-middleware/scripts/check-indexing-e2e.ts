/**
 * Indexing end-to-end with full step logging (needs OpenSearch + embeddings).
 *
 * One sample DB row flows through every real stage:
 *   1. transform      (DefaultDocumentTransformer + middleware model)
 *   2. embed          (live embedding service → vector attached)
 *   3. store          (live OpenSearch index, refresh=true)
 *   4. read back      (GET _doc — proves the vector persisted)
 *   5. semantic query (axis.searchDocuments → knn → scored hits)
 *   6. cleanup        (delete only our test doc)
 *
 * Usage:
 *   npx tsx scripts/check-indexing-e2e.ts
 *
 * Exits 0 when all checks pass, 1 otherwise.
 */
import "dotenv/config";
import { DefaultDocumentTransformer } from "axis";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const TEST_DOC_ID = "axis-indexing-e2e-1";
const QUERY_TEXT = "machine learning infrastructure";

const SAMPLE_ROW = {
  requisition_id: TEST_DOC_ID,
  department_name: "Machine Learning Platform",
  status: 1,
  tenant_id: "tenant-001",
};

let failures = 0;

function pass(step: string, detail = "") {
  console.log(`\nPASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, detail = "") {
  failures += 1;
  console.error(`\nFAIL: ${step}${detail ? ` — ${detail}` : ""}`);
}

function logBlock(title: string, value: unknown) {
  console.log(`\n----- ${title} -----`);
  console.log(JSON.stringify(value, null, 2));
}

function vectorPreview(vec: number[]) {
  return { dims: vec.length, first8: vec.slice(0, 8) };
}

async function main() {
  if (!config.opensearchUrl) {
    console.error("FAIL: OPENSEARCH_URL is not set in .env");
    process.exit(1);
  }
  if (!config.embeddingUrl || !config.embeddingModel) {
    console.error("FAIL: EMBEDDING_URL / EMBEDDING_MODEL are not set in .env");
    process.exit(1);
  }

  const ctx = createApp(config.databaseUrl, {
    cacheEnabled: false,
    opensearchUrl: config.opensearchUrl,
    embeddingUrl: config.embeddingUrl,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingApiKey: config.embeddingApiKey || undefined,
    embeddingDimensions: config.embeddingDimensions,
  });
  const { axis, registry } = ctx;

  try {
    const model = registry.get("PurchaseRequisitions");
    const index = model.search?.index ?? model.name;
    const adapter = axis.search;
    const provider = axis.embeddings;
    if (!adapter) {
      fail("wiring", "no search adapter");
      process.exit(1);
    }
    if (!provider) {
      fail("wiring", "no embedding provider");
      process.exit(1);
    }
    pass("wiring", `index=${index}, embeddings=${provider.name}`);

    // ---- 1. TRANSFORM ----
    logBlock("1a. input DB row", SAMPLE_ROW);
    const transformer = new DefaultDocumentTransformer(model);
    const doc = await transformer.transform({ ...SAMPLE_ROW });
    logBlock("1b. transformed SearchDocument (no vector yet)", doc);
    if (doc.id === TEST_DOC_ID && doc.searchableText) {
      pass("1. transform", `searchableText=${JSON.stringify(doc.searchableText)}`);
    } else {
      fail("1. transform", "missing id or searchableText");
    }

    // ---- 2. EMBED ----
    const texts = [doc.searchableText ?? ""];
    const vectors = await provider.embedBatch(texts);
    const vector = vectors[0] as number[];
    doc.embedding = vector;
    logBlock("2. query vector attached", {
      dims: vector.length,
      first8: vector.slice(0, 8),
    });
    if (vector.length > 0) {
      pass("2. embed", `${vector.length} dims`);
    } else {
      fail("2. embed", "empty vector");
    }

    // ---- 3. STORE ----
    const indexResult = await adapter.index({
      index,
      id: doc.id,
      document: {
        ...doc.fields,
        tenant_id: doc.tenantId,
        searchable_text: doc.searchableText,
        embedding: doc.embedding,
      },
      refresh: true,
    });
    logBlock("3. OpenSearch index response", indexResult);
    pass("3. store", `result=${indexResult.result}`);

    // ---- 4. READ BACK ----
    const base = config.opensearchUrl.replace(/\/+$/, "");
    const storedRes = await fetch(`${base}/${index}/_doc/${TEST_DOC_ID}`);
    if (!storedRes.ok) {
      fail("4. read back", `HTTP ${storedRes.status}`);
    } else {
      const stored = (await storedRes.json()) as {
        _source?: Record<string, unknown>;
      };
      const storedVec = stored._source?.["embedding"] as number[] | undefined;
      logBlock("4. stored _source (vector truncated)", {
        ...stored._source,
        embedding: storedVec ? vectorPreview(storedVec) : undefined,
      });
      if (Array.isArray(storedVec) && storedVec.length === vector.length) {
        pass("4. read back", `vector persisted (${storedVec.length} dims)`);
      } else {
        fail("4. read back", "stored vector missing or wrong size");
      }
    }

    // ---- 5. SEMANTIC QUERY ----
    const wrappedSearch = adapter.search.bind(adapter);
    adapter.search = (async (...args: Parameters<typeof wrappedSearch>) => {
      const params = args[0] as { query?: unknown };
      const query = JSON.parse(JSON.stringify(params.query ?? null)) as {
        knn?: { embedding?: { vector?: unknown } };
      };
      if (query.knn?.embedding) {
        query.knn.embedding = { vector: "[384 floats omitted]" } as never;
      }
      logBlock("5a. outgoing OpenSearch body", query);
      return wrappedSearch(...args);
    }) as typeof wrappedSearch;

    const input = {
      model: "PurchaseRequisitions",
      search: { type: "semantic", text: QUERY_TEXT },
      limit: 3,
    };
    logBlock("5b. Axis search input", input);
    const result = await axis.searchDocuments(input);
    logBlock(
      "5c. hits",
      (result.rows as Record<string, unknown>[]).map((r) => ({
        _id: r["_id"],
        _score: r["_score"],
        businessUnit: r["businessUnit"],
        department: r["department"],
        embeddingDims: Array.isArray(r["embedding"])
          ? (r["embedding"] as number[]).length
          : undefined,
      })),
    );
    const found = result.rows.some(
      (r) => (r as Record<string, unknown>)._id === TEST_DOC_ID,
    );
    if (found) {
      pass("5. semantic query", `test doc returned (rowCount=${result.rowCount})`);
    } else {
      fail("5. semantic query", "test doc not in hits");
    }

    // ---- 6. CLEANUP ----
    const delRes = await fetch(`${base}/${index}/_doc/${TEST_DOC_ID}?refresh=true`, {
      method: "DELETE",
    });
    if (delRes.ok) {
      pass("6. cleanup (delete test doc)");
    } else {
      fail("6. cleanup (delete test doc)", `HTTP ${delRes.status}`);
    }
  } finally {
    await ctx.axis.close();
  }

  console.log(
    failures === 0
      ? "\nAll indexing e2e checks passed."
      : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
