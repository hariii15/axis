/**
 * Semantic end-to-end check (needs embeddings + OpenSearch).
 *
 * Flow: embedding service → query vector → axis.searchDocuments()
 * (compile knn DSL → OpenSearch k-NN → normalized rows) → cache hit.
 *
 * Uses a dedicated test index (`axis-semantic-e2e`) with a real
 * knn_vector mapping — never touches application indices.
 *
 * Usage:
 *   npx tsx scripts/check-semantic-e2e.ts
 *
 * Exits 0 when all checks pass, 1 otherwise.
 */
import "dotenv/config";
import {
  Axis,
  defineModel,
  ModelRegistry,
  OpenAICompatibleEmbeddingProvider,
  OpenSearchAdapter,
} from "axis";

const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? "";
const EMBEDDING_URL = process.env.EMBEDDING_URL ?? "";
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "sentence-transformers/all-MiniLM-L6-v2";

const TEST_INDEX = "axis-semantic-e2e";
const QUERY_TEXT = "machine learning computer";

const DOCS = [
  { id: "doc-ml", title: "GPU workstation for machine learning development" },
  { id: "doc-chairs", title: "office chairs for the meeting room" },
  { id: "doc-cables", title: "laptop chargers and USB cables" },
];

let failures = 0;

function pass(step: string, detail = "") {
  console.log(`PASS: ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, detail = "") {
  failures += 1;
  console.error(`FAIL: ${step}${detail ? ` — ${detail}` : ""}`);
}

function logBlock(title: string, value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const preview = text.length > 2000 ? `${text.slice(0, 2000)}\n…(truncated)` : text;
  console.log(`\n----- ${title} -----\n${preview}\n`);
}

async function main() {
  if (!OPENSEARCH_URL) {
    console.error("FAIL: OPENSEARCH_URL is not set in .env");
    process.exit(1);
  }
  if (!EMBEDDING_URL) {
    console.error("FAIL: EMBEDDING_URL is not set in .env");
    process.exit(1);
  }

  // 1. Embedding service health + vector probe.
  const embeddings = new OpenAICompatibleEmbeddingProvider({
    baseURL: EMBEDDING_URL,
    model: EMBEDDING_MODEL,
  });
  let dims = 0;
  try {
    const healthy = await embeddings.healthCheck();
    const probe = await embeddings.embed("health probe");
    dims = probe.length;
    logBlock("probe vector (first 8 values)", probe.slice(0, 8));
    if (healthy && dims > 0) {
      pass("embedding service", `model=${EMBEDDING_MODEL}, dims=${dims}`);
    } else {
      fail("embedding service", `healthy=${healthy}, dims=${dims}`);
    }
  } catch (error) {
    fail("embedding service", String(error));
    console.error("\nEmbedding service unreachable — skipping remaining checks.");
    process.exit(1);
  }

  const expectedDims = Number(process.env.EMBEDDING_DIMENSIONS ?? dims);
  if (expectedDims !== dims) {
    fail(
      "embedding dimensions",
      `service=${dims} but EMBEDDING_DIMENSIONS=${expectedDims} (mapping would reject vectors)`,
    );
  } else {
    pass("embedding dimensions", `${dims} (matches mapping below)`);
  }

  // 2. Test model + Axis wired to both containers.
  const TestModel = defineModel({
    name: "E2ECheck",
    source: { type: "table", table: "public.e2e" },
    axes: {
      id: { sql: "id", type: "string", primaryKey: true },
      title: { sql: "title", type: "string" },
    },
    metrics: { newCount: { type: "count" } },
    search: {
      index: TEST_INDEX,
      searchable: ["title"],
      embeddingInput: ["title"],
      embeddingField: "embedding",
    },
  });
  const registry = new ModelRegistry();
  registry.register(TestModel);

  const searchAdapter = new OpenSearchAdapter({ url: OPENSEARCH_URL });
  const axis = new Axis({
    database: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres" },
    registry,
    cache: { enabled: true },
    searchAdapter,
    embeddings: { instance: embeddings },
  });

  // Count live OpenSearch calls (cache verification).
  let liveCalls = 0;
  const originalSearch = searchAdapter.search.bind(searchAdapter);
  searchAdapter.search = (async (...args: Parameters<typeof originalSearch>) => {
    liveCalls += 1;
    const params = args[0] as { knn?: unknown; query?: unknown; size?: unknown };
    logBlock("outgoing OpenSearch request body", {
      knn: params.knn !== undefined ? "[vector omitted]" : undefined,
      query: params.query,
      size: params.size,
    });
    return originalSearch(...args);
  }) as typeof originalSearch;

  try {
    // 3. Create the test index with a real knn_vector mapping.
    const base = OPENSEARCH_URL.replace(/\/+$/, "");
    await fetch(`${base}/${TEST_INDEX}`, { method: "DELETE" }).catch(() => undefined);
    const mappingRes = await fetch(`${base}/${TEST_INDEX}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { "index.knn": true },
        mappings: {
          properties: {
            embedding: { type: "knn_vector", dimension: dims },
            title: { type: "text" },
          },
        },
      }),
    });
    if (mappingRes.ok) {
      pass("create test index with knn_vector mapping", `dimension=${dims}`);
    } else {
      fail("create test index with knn_vector mapping", `HTTP ${mappingRes.status}`);
      process.exit(1);
    }

    // 4. Embed + index the sample docs (same path as axis.index).
    const vectors = await embeddings.embedBatch(DOCS.map((d) => d.title));
    for (let i = 0; i < DOCS.length; i += 1) {
      const doc = DOCS[i] as { id: string; title: string };
      await searchAdapter.index({
        index: TEST_INDEX,
        id: doc.id,
        document: { title: doc.title, embedding: vectors[i] },
        refresh: true,
      });
    }
    pass("indexed sample docs with vectors", `${DOCS.length} docs`);

    // 5. Semantic search end-to-end through Axis.
    const input = {
      model: "E2ECheck",
      search: { type: "semantic", text: QUERY_TEXT },
      limit: 3,
    };
    logBlock("Axis search input", input);
    const result = await axis.searchDocuments(input);
    logBlock(
      "search results (id + score)",
      (result.rows as Record<string, unknown>[]).map((r) => ({
        _id: r["_id"],
        _score: r["_score"],
        title: r["title"],
      })),
    );

    const topId = (result.rows[0] as Record<string, unknown> | undefined)?.["_id"];
    if (topId === "doc-ml") {
      pass("semantic ranking", `"${QUERY_TEXT}" → doc-ml on top`);
    } else {
      fail("semantic ranking", `expected doc-ml on top, got ${String(topId)}`);
    }

    // 6. Repeat → cache, no 2nd live call.
    await axis.searchDocuments(input);
    if (liveCalls === 1) {
      pass("repeat search served from cache");
    } else {
      fail("repeat search served from cache", `liveCalls=${liveCalls}`);
    }
  } finally {
    try {
      await searchAdapter.deleteIndex(TEST_INDEX);
      pass("cleanup (delete test index)");
    } catch (error) {
      fail("cleanup (delete test index)", String(error));
    }
    await axis.close();
  }

  console.log(
    failures === 0 ? "\nAll semantic e2e checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: unexpected error — ${String(error)}`);
  process.exit(1);
});
