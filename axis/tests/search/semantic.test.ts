import { describe, expect, it, vi } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { buildCacheKey } from "../../src/core/cache/index.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const Model = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
    title: { sql: "title", type: "string" },
  },
  metrics: {
    newCount: { type: "count" },
  },
  search: {
    index: "purchase-requisitions",
    searchable: ["title"],
    embeddingInput: ["title"],
  },
});

function makeRegistry() {
  const registry = new ModelRegistry();
  registry.register(Model);
  return registry;
}

function makeSearch() {
  return {
    index: vi.fn(async () => ({})),
    search: vi.fn(async () => ({
      hits: [
        {
          _index: "purchase-requisitions",
          _id: "REQ-100",
          _score: 0.92,
          _source: { title: "GPU workstation" },
        },
      ],
      total: { value: 1, relation: "eq" as const },
      took: 2,
      timedOut: false,
    })),
    deleteIndex: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

function makeEmbeddings() {
  return {
    embed: vi.fn(async (text: string) => [text.length, 0.5, 0.25]),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map((t) => [t.length, 0.5, 0.25]),
    ),
    getDimensions: () => 3,
    healthCheck: async () => true,
    close: async () => undefined,
  };
}

describe("Phase 9: axis.searchDocuments()", () => {
  it("embeds the text and runs knn search with normalized rows", async () => {
    const search = makeSearch();
    const embeddings = makeEmbeddings();
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      cache: { enabled: true },
      searchAdapter: search as never,
      embeddings: { instance: embeddings as never },
    });
    try {
      const result = await axis.searchDocuments<{
        title: string;
        _id: string;
        _score: number;
      }>({
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "ML infrastructure" },
        limit: 5,
      });
      expect(embeddings.embed).toHaveBeenCalledWith("ML infrastructure");
      expect(search.search).toHaveBeenCalledOnce();
      const params = search.search.mock.calls[0]?.[0] as {
        index: string;
        query: { knn: { embedding: { k: number; vector: number[] } } };
        size: number;
      };
      expect(params.index).toBe("purchase-requisitions");
      expect(params.size).toBe(5);
      expect(params.query.knn.embedding.k).toBe(5);
      expect(params.query.knn.embedding.vector).toHaveLength(3);
      expect(result.rows).toEqual([
        { title: "GPU workstation", _id: "REQ-100", _score: 0.92 },
      ]);
      expect(result.rowCount).toBe(1);

      // Repeat hits the cache — no second embedding or search call.
      await axis.searchDocuments({
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "ML infrastructure" },
        limit: 5,
      });
      expect(embeddings.embed).toHaveBeenCalledTimes(1);
      expect(search.search).toHaveBeenCalledTimes(1);
    } finally {
      await axis.close();
    }
  });

  it("throws when semantic search has no embedding provider", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      searchAdapter: makeSearch() as never,
    });
    try {
      await expect(
        axis.searchDocuments({
          model: "PurchaseRequisitions",
          search: { type: "semantic", text: "x" },
        }),
      ).rejects.toThrow(/embedding provider/);
    } finally {
      await axis.close();
    }
  });

  it("throws when no search adapter is configured", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      embeddings: { instance: makeEmbeddings() as never },
    });
    try {
      await expect(
        axis.searchDocuments({
          model: "PurchaseRequisitions",
          search: { type: "fulltext", text: "x" },
        }),
      ).rejects.toThrow(/not configured/);
    } finally {
      await axis.close();
    }
  });

  it("applies security filters to the search", async () => {
    const search = makeSearch();
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      searchAdapter: search as never,
      embeddings: { instance: makeEmbeddings() as never },
      security: {
        mappings: {
          tenant: {
            contextKey: "tenant",
            column: "tenant_id",
            sessionKey: "app.tenant_id",
            required: true,
          },
        },
      },
    });
    try {
      await axis.searchDocuments(
        {
          model: "PurchaseRequisitions",
          search: { type: "fulltext", text: "chairs" },
        },
        { context: { tenant: "tenant-001" } },
      );
      const params = search.search.mock.calls[0]?.[0] as {
        query: { bool: { filter: unknown[] } };
      };
      expect(params.query.bool.filter).toContainEqual({
        term: { tenant_id: "tenant-001" },
      });
    } finally {
      await axis.close();
    }
  });
});

describe("Phase 9: cache keys include search", () => {
  it("different search text produces different keys", () => {
    const base = { model: "M", metrics: ["c"] } as const;
    const a = buildCacheKey({ ...base, search: { type: "semantic", text: "one" } });
    const b = buildCacheKey({ ...base, search: { type: "semantic", text: "two" } });
    expect(a).not.toBe(b);
  });

  it("queries without search keep legacy-compatible keys", () => {
    const a = buildCacheKey({ model: "M", metrics: ["c"] });
    const b = buildCacheKey({ model: "M", metrics: ["c"] });
    expect(a).toBe(b);
  });
});
