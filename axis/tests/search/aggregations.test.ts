import { describe, expect, it, vi } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import { normalizeAggregationRows } from "../../src/core/compiler/opensearch/index.js";
import { OpenSearchAdapter } from "../../src/core/search/OpenSearchAdapter.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const Model = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
    department: { sql: "department_name", type: "string" },
  },
  metrics: {
    newCount: { type: "count" },
  },
  search: {
    index: "purchase-requisitions",
    searchable: ["department"],
  },
});

function makeRegistry() {
  const registry = new ModelRegistry();
  registry.register(Model);
  return registry;
}

function stubClient(aggregations: Record<string, unknown>) {
  return {
    search: vi.fn(async () => ({
      body: {
        took: 2,
        timed_out: false,
        hits: {
          total: { value: 0, relation: "eq" },
          hits: [],
        },
        aggregations,
      },
      statusCode: 200,
    })),
    index: vi.fn(async () => ({})),
    indices: {
      delete: vi.fn(async () => ({})),
    },
    cluster: {
      health: vi.fn(async () => ({ body: { status: "green" } })),
    },
    close: vi.fn(async () => undefined),
  };
}

describe("normalizeAggregationRows", () => {
  it("builds a single row from top-level metric aggs", () => {
    expect(
      normalizeAggregationRows([], ["newCount"], {
        newCount: { value: 6 },
      }),
    ).toEqual([{ newCount: 6 }]);
  });

  it("builds one row per terms bucket for grouped queries", () => {
    expect(
      normalizeAggregationRows(["department"], ["newCount"], {
        newCount: { value: 6 },
        department_terms: {
          buckets: [
            { key: "Engineering", newCount: { value: 4 } },
            { key: "Chemical", newCount: { value: 2 } },
          ],
        },
      }),
    ).toEqual([
      { department: "Engineering", newCount: 4 },
      { department: "Chemical", newCount: 2 },
    ]);
  });

  it("keeps null metric values instead of dropping the row", () => {
    expect(
      normalizeAggregationRows([], ["amountTotal"], {
        amountTotal: { value: null },
      }),
    ).toEqual([{ amountTotal: null }]);
  });

  it("returns no rows when the terms agg is missing", () => {
    expect(normalizeAggregationRows(["department"], ["newCount"], {})).toEqual(
      [],
    );
  });
});

describe("OpenSearchAdapter aggregations", () => {
  it("sends aggs and surfaces response aggregations", async () => {
    const client = stubClient({ newCount: { value: 6 } });
    const adapter = new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    });
    const result = await adapter.search({
      index: "purchase-requisitions",
      query: { matchAll: {} },
      size: 0,
      aggs: { newCount: { value_count: { field: "_id" } } },
    });
    const sent = client.search.mock.calls[0]?.[0] as {
      body: { aggs: unknown; size: number };
    };
    expect(sent.body.aggs).toEqual({ newCount: { value_count: { field: "_id" } } });
    expect(sent.body.size).toBe(0);
    expect(result.aggregations).toEqual({ newCount: { value: 6 } });
  });
});

describe("axis.searchDocuments() with metrics", () => {
  it("returns a SQL-shaped single row for metric-only queries", async () => {
    const client = stubClient({ newCount: { value: 6 } });
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      searchAdapter: new OpenSearchAdapter({
        url: "http://localhost:9200",
        client: client as never,
      }),
    });
    try {
      const result = await axis.searchDocuments({
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
      });
      const sent = client.search.mock.calls[0]?.[0] as {
        body: { aggs: unknown; size: number };
      };
      expect(sent.body.size).toBe(0);
      expect(sent.body.aggs).toMatchObject({
        newCount: { value_count: { field: "_id" } },
      });
      expect(result.rows).toEqual([{ newCount: 6 }]);
      expect(result.rowCount).toBe(1);
    } finally {
      await axis.close();
    }
  });

  it("returns one row per bucket for axes + metrics", async () => {
    const client = stubClient({
      newCount: { value: 6 },
      department_terms: {
        buckets: [
          { key: "Engineering", doc_count: 4, newCount: { value: 4 } },
          { key: "Chemical", doc_count: 2, newCount: { value: 2 } },
        ],
      },
    });
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: makeRegistry(),
      searchAdapter: new OpenSearchAdapter({
        url: "http://localhost:9200",
        client: client as never,
      }),
    });
    try {
      const result = await axis.searchDocuments({
        model: "PurchaseRequisitions",
        axes: ["department"],
        metrics: ["newCount"],
      });
      expect(result.rows).toEqual([
        { department: "Engineering", newCount: 4 },
        { department: "Chemical", newCount: 2 },
      ]);
      expect(result.rowCount).toBe(2);
    } finally {
      await axis.close();
    }
  });

  it("walks nested terms buckets into one row per leaf (multi-axis)", async () => {
    expect(
      normalizeAggregationRows(["department", "status"], ["newCount"], {
        newCount: { value: 6 },
        department_terms: {
          buckets: [
            {
              key: "Engineering",
              status_terms: {
                buckets: [
                  { key: 1, newCount: { value: 3 } },
                  { key: 2, newCount: { value: 1 } },
                ],
              },
            },
            {
              key: "Chemical",
              status_terms: { buckets: [{ key: 2, newCount: { value: 2 } }] },
            },
          ],
        },
      }),
    ).toEqual([
      { department: "Engineering", status: 1, newCount: 3 },
      { department: "Engineering", status: 2, newCount: 1 },
      { department: "Chemical", status: 2, newCount: 2 },
    ]);
  });

  it("emits no rows for branches with missing nested aggs", async () => {
    expect(
      normalizeAggregationRows(["department", "status"], ["newCount"], {
        department_terms: { buckets: [{ key: "Engineering" }] },
      }),
    ).toEqual([]);
  });

  it("unwraps filter-wrapped canned metrics independently", async () => {
    expect(
      normalizeAggregationRows([], ["msmeCount", "microCount"], {
        msmeCount: { doc_count: 23, value: { value: 23 } },
        microCount: { doc_count: 8, value: { value: 8 } },
      }),
    ).toEqual([{ msmeCount: 23, microCount: 8 }]);
  });

  it("sends nested terms aggs and reads all axis keys (multi-axis e2e)", async () => {
    const TwoAxis = defineModel({
      name: "TwoAxis",
      source: { type: "table", table: "public.t" },
      axes: {
        department: { sql: "department_name", type: "string" },
        status: { sql: "status", type: "number" },
      },
      metrics: { newCount: { type: "count" } },
      search: { index: "two-axis", searchable: ["department"] },
    });
    const registry = new ModelRegistry();
    registry.register(TwoAxis);
    const client = stubClient({
      newCount: { value: 4 },
      department_terms: {
        buckets: [
          {
            key: "Engineering",
            status_terms: {
              buckets: [
                { key: 1, newCount: { value: 3 } },
                { key: 2, newCount: { value: 1 } },
              ],
            },
          },
        ],
      },
    });
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry,
      searchAdapter: new OpenSearchAdapter({
        url: "http://localhost:9200",
        client: client as never,
      }),
    });
    try {
      const result = await axis.searchDocuments({
        model: "TwoAxis",
        axes: ["department", "status"],
        metrics: ["newCount"],
      });
      const sent = client.search.mock.calls[0]?.[0] as {
        body: { aggs: Record<string, unknown> };
      };
      expect(sent.body.aggs["department_terms"]).toMatchObject({
        terms: { field: "department.keyword" },
        aggs: {
          status_terms: {
            terms: { field: "status" },
            aggs: { newCount: { value_count: { field: "_id" } } },
          },
        },
      });
      expect(result.rows).toEqual([
        { department: "Engineering", status: 1, newCount: 3 },
        { department: "Engineering", status: 2, newCount: 1 },
      ]);
      expect(result.rowCount).toBe(2);
    } finally {
      await axis.close();
    }
  });
});
