import { describe, expect, it, vi } from "vitest";

import { ModelIndexer } from "../../src/core/indexing/indexer.js";
import { DefaultDocumentTransformer } from "../../src/core/indexing/transformer.js";
import { BulkIndexer } from "../../src/core/indexing/bulk.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import { Axis } from "../../src/core/axis.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const Model = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
    id: { sql: "requisition_id", type: "string", primaryKey: true },
    title: { sql: "title", type: "string" },
    department: {
      sql: "department_name",
      type: "string",
      search: { field: "dept" },
    },
  },
  metrics: {
    newCount: { type: "count" },
  },
  search: {
    index: "purchase-requisitions",
    searchable: ["title", "department"],
    embeddingInput: ["title", "department"],
  },
});

function makeRegistry() {
  const registry = new ModelRegistry();
  registry.register(Model);
  return registry;
}

function makeDb(rows: Record<string, unknown>[] = []) {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  };
}

function makeSearch() {
  return {
    index: vi.fn(async () => ({
      _index: "purchase-requisitions",
      _id: "x",
      _version: 1,
      result: "created" as const,
    })),
    search: vi.fn(async () => ({ hits: [], total: 0, took: 1, timedOut: false })),
    deleteIndex: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

function makeEmbeddings() {
  return {
    embed: vi.fn(async (text: string) => [text.length, 0.5]),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map((t) => [t.length, 0.5]),
    ),
    getDimensions: () => 2,
    healthCheck: async () => true,
    close: async () => undefined,
  };
}

const ROWS = [
  {
    requisition_id: "REQ-100",
    title: "GPU workstation",
    department_name: "Engineering",
    tenant_id: "tenant-001",
  },
  {
    requisition_id: "REQ-101",
    title: "Office chairs",
    department_name: "Facilities",
    tenant_id: "tenant-001",
  },
];

describe("Phase 8: DefaultDocumentTransformer", () => {
  it("maps rows to search documents with search field names", async () => {
    const transformer = new DefaultDocumentTransformer(Model);
    const doc = await transformer.transform(ROWS[0] as Record<string, unknown>);
    expect(doc.id).toBe("REQ-100");
    expect(doc.tenantId).toBe("tenant-001");
    expect(doc.fields).toMatchObject({ dept: "Engineering" });
    expect(doc.searchableText).toContain("GPU workstation");
  });

  it("throws when the id column is missing", async () => {
    const transformer = new DefaultDocumentTransformer(Model);
    await expect(transformer.transform({ title: "x" })).rejects.toThrow(
      /document id/,
    );
  });
});

describe("Phase 8: BulkIndexer", () => {
  it("writes documents and counts successes", async () => {
    const search = makeSearch();
    const bulk = new BulkIndexer(search as never, { retryDelayMs: 0 });
    const result = await bulk.indexDocuments("purchase-requisitions", [
      { id: "a", fields: { title: "x" } },
      { id: "b", fields: { title: "y" } },
    ]);
    expect(result).toMatchObject({ indexed: 2, failed: 0 });
    expect(search.index).toHaveBeenCalledTimes(2);
  });

  it("retries failures and collects errors per document", async () => {
    const search = makeSearch();
    search.index
      .mockRejectedValueOnce(new Error("boom-1"))
      .mockRejectedValueOnce(new Error("boom-2"));
    // Third attempt succeeds for doc "a"; doc "b" always fails.
    search.index.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "b") throw new Error("permanent");
      return { _index: "i", _id: id, _version: 1, result: "created" as const };
    });
    const bulk = new BulkIndexer(search as never, {
      retryAttempts: 3,
      retryDelayMs: 0,
    });
    const result = await bulk.indexDocuments("idx", [
      { id: "a", fields: {} },
      { id: "b", fields: {} },
    ]);
    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ id: "b" });
  });
});

describe("Phase 8: ModelIndexer", () => {
  it("fetches, transforms, embeds and bulk-indexes", async () => {
    const db = makeDb(ROWS as Record<string, unknown>[]);
    const search = makeSearch();
    const embeddings = makeEmbeddings();
    const indexer = new ModelIndexer({
      database: db as never,
      registry: makeRegistry(),
      search: search as never,
      embeddings: embeddings as never,
      retryDelayMs: 0,
    });
    const result = await indexer.index("PurchaseRequisitions");
    expect(result).toMatchObject({ model: "PurchaseRequisitions", indexed: 2, failed: 0 });
    expect(db.query).toHaveBeenCalledOnce();
    expect(String(db.query.mock.calls[0]?.[0])).toContain(
      "FROM upeg.requisition_deails",
    );
    expect(embeddings.embedBatch).toHaveBeenCalledOnce();
    expect(search.index).toHaveBeenCalledTimes(2);
    const firstDoc = search.index.mock.calls[0]?.[0] as {
      index: string;
      id: string;
      document: Record<string, unknown>;
    };
    expect(firstDoc.index).toBe("purchase-requisitions");
    expect(firstDoc.id).toBe("REQ-100");
    expect(firstDoc.document).toMatchObject({
      dept: "Engineering",
      tenant_id: "tenant-001",
    });
    expect(firstDoc.document["embedding"]).toBeDefined();
  });

  it("applies where/limit and since filters in SQL", async () => {
    const db = makeDb([]);
    const search = makeSearch();
    const indexer = new ModelIndexer({
      database: db as never,
      registry: makeRegistry(),
      search: search as never,
      embeddings: makeEmbeddings() as never,
      retryDelayMs: 0,
    });
    await indexer.index("PurchaseRequisitions", {
      where: { tenant_id: "tenant-001" },
      limit: 10,
      since: new Date("2026-01-01T00:00:00.000Z"),
    });
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE");
    expect(sql).toContain("tenant_id = $1");
    expect(sql).toContain("updated_at >= $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual(["tenant-001", "2026-01-01T00:00:00.000Z", 10]);
  });

  it("fails closed when embeddings are required but missing", async () => {
    const db = makeDb(ROWS as Record<string, unknown>[]);
    const search = makeSearch();
    const indexer = new ModelIndexer({
      database: db as never,
      registry: makeRegistry(),
      search: search as never,
      retryDelayMs: 0,
    });
    await expect(indexer.index("PurchaseRequisitions")).rejects.toThrow(
      /embedding provider/,
    );
  });

  it("throws for models without a search index", async () => {
    const registry = new ModelRegistry();
    registry.register(
      defineModel({
        name: "NoSearch",
        source: { type: "table", table: "public.t" },
        axes: { a: { sql: "a", type: "string" } },
        metrics: { c: { type: "count" } },
      }),
    );
    const indexer = new ModelIndexer({
      database: makeDb() as never,
      registry,
      search: makeSearch() as never,
      retryDelayMs: 0,
    });
    await expect(indexer.index("NoSearch")).rejects.toThrow(/search index/);
  });

  it("getStatus counts documents via the search adapter", async () => {
    const search = makeSearch();
    search.search.mockResolvedValueOnce({
      hits: [],
      total: { value: 42, relation: "eq" as const },
      took: 1,
      timedOut: false,
    });
    const indexer = new ModelIndexer({
      database: makeDb() as never,
      registry: makeRegistry(),
      search: search as never,
      retryDelayMs: 0,
    });
    const status = await indexer.getStatus("PurchaseRequisitions");
    expect(status).toMatchObject({ model: "PurchaseRequisitions", documentCount: 42 });
  });
});

describe("Phase 8: Axis.index()", () => {
  it("throws when no search adapter is configured", async () => {
    const axis = new Axis({ database: { url: UNREACHABLE_DB } });
    try {
      expect(axis.indexer).toBeUndefined();
      await expect(axis.index("PurchaseRequisitions")).rejects.toThrow(
        /not configured/,
      );
    } finally {
      await axis.close();
    }
  });
});
