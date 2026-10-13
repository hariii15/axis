import { describe, expect, it, vi } from "vitest";

import { OpenSearchAdapter } from "../../src/core/search/OpenSearchAdapter.js";

/**
 * Regression test: the OpenSearch client returns a transport wrapper
 * `{ body, statusCode, headers, meta }` — the adapter must unwrap `.body`.
 */
function stubClient() {
  return {
    search: vi.fn(async () => ({
      body: {
        took: 3,
        timed_out: false,
        hits: {
          total: { value: 1, relation: "eq" },
          hits: [
            {
              _index: "idx",
              _id: "1",
              _score: 1.0,
              _source: { title: "hello" },
            },
          ],
        },
      },
      statusCode: 200,
    })),
    index: vi.fn(async () => ({
      body: { _index: "idx", _id: "1", _version: 1, result: "created" },
      statusCode: 201,
    })),
    indices: {
      delete: vi.fn(async () => ({ body: {}, statusCode: 200 })),
    },
    cluster: {
      health: vi.fn(async () => ({
        body: { cluster_name: "test", status: "green" },
        statusCode: 200,
      })),
    },
    close: vi.fn(async () => undefined),
  };
}

describe("OpenSearchAdapter transport wrapper", () => {
  it("unwraps .body for search, index and healthCheck", async () => {
    const client = stubClient();
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });

    const result = await adapter.search({
      index: "idx",
      query: { matchAll: {} },
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ _id: "1" });
    expect(result.total).toEqual({ value: 1, relation: "eq" });

    const indexed = await adapter.index({
      index: "idx",
      id: "1",
      document: { title: "hello" },
    });
    expect(indexed).toMatchObject({ _id: "1", result: "created" });

    await expect(adapter.healthCheck()).resolves.toBe(true);

    // Injected client is never closed by the adapter.
    await adapter.close();
    expect(client.close).not.toHaveBeenCalled();
  });

  it("passes compiler-emitted knn maps through without double-wrapping", async () => {
    const client = stubClient();
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    await adapter.search({
      index: "idx",
      query: {
        knn: { embedding: { vector: [0.1, 0.2], k: 3 } },
      },
    });
    const body = client.search.mock.calls[0]?.[0] as {
      body: { query: { knn: unknown } };
    };
    expect(body.body.query.knn).toEqual({
      embedding: { vector: [0.1, 0.2], k: 3 },
    });
  });

  it("expands single-clause knn into the map form", async () => {
    const client = stubClient();
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    await adapter.search({
      index: "idx",
      query: {
        knn: { field: "embedding", vector: [0.1, 0.2], k: 3 },
      },
    });
    const body = client.search.mock.calls[0]?.[0] as {
      body: { query: { knn: unknown } };
    };
    expect(body.body.query.knn).toEqual({
      embedding: { vector: [0.1, 0.2], k: 3 },
    });
  });

  it("passes leaf filter clauses through untouched (never match_all)", async () => {
    const client = stubClient();
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    await adapter.search({
      index: "idx",
      query: {
        bool: {
          filter: [
            { term: { tenant_id: "t1" } },
            { range: { status: { gte: 1 } } },
            { exists: { field: "title" } },
          ],
        },
      } as never,
    });
    const body = client.search.mock.calls[0]?.[0] as {
      body: { query: { bool: { filter: unknown[] } } };
    };
    expect(body.body.query.bool.filter).toEqual([
      { term: { tenant_id: "t1" } },
      { range: { status: { gte: 1 } } },
      { exists: { field: "title" } },
    ]);
  });

  it("preserves minimum_should_match on bool queries", async () => {
    const client = stubClient();
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    await adapter.search({
      index: "idx",
      query: {
        bool: {
          filter: [{ term: { tenant_id: "t1" } }],
          should: [{ match: { title: "x" } }],
          minimum_should_match: 1,
        },
      } as never,
    });
    const body = client.search.mock.calls[0]?.[0] as {
      body: { query: { bool: Record<string, unknown> } };
    };
    expect(body.body.query.bool.minimum_should_match).toBe(1);
    expect(body.body.query.bool.filter).toEqual([
      { term: { tenant_id: "t1" } },
    ]);
  });

  it("reports red clusters as unhealthy", async () => {
    const client = stubClient();
    client.cluster.health.mockResolvedValueOnce({
      body: { status: "red" },
      statusCode: 200,
    });
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    await expect(adapter.healthCheck()).resolves.toBe(false);
  });
});
