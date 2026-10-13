import { describe, expect, it, vi } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import { OpenSearchAdapter } from "../../src/core/search/OpenSearchAdapter.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const Model = defineModel({
  name: "Companies",
  source: { type: "table", table: "vendor_companies" },
  axes: {
    id: { sql: "company_id", type: "string", primaryKey: true },
    companyName: { sql: "company_name", type: "string" },
    msme: { sql: "msme", type: "string" },
  },
  metrics: {
    totalCompanies: { type: "count" },
  },
  search: {
    index: "companies",
    searchable: ["companyName"],
  },
});

function stubClient(hits: Record<string, unknown>[]) {
  return {
    search: vi.fn(async () => ({
      body: {
        took: 1,
        timed_out: false,
        hits: {
          total: { value: hits.length, relation: "eq" },
          hits: hits.map((s, i) => ({
            _index: "companies",
            _id: `VEN000${i + 1}`,
            _source: s,
          })),
        },
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

function makeAxis(client: ReturnType<typeof stubClient>) {
  const registry = new ModelRegistry();
  registry.register(Model);
  return new Axis({
    database: { url: UNREACHABLE_DB },
    registry,
    searchAdapter: new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    }),
  });
}

function sentBody(client: ReturnType<typeof stubClient>) {
  return client.search.mock.calls[0]?.[0] as {
    body: Record<string, unknown>;
  };
}

describe("axes-only queries project _source", () => {
  it("sends _source with just the requested axes", async () => {
    const client = stubClient([{ companyName: "Apex" }]);
    const axis = makeAxis(client);
    try {
      const result = await axis.searchDocuments({
        model: "Companies",
        axes: ["companyName"],
      });
      expect(sentBody(client).body._source).toEqual(["companyName"]);
      expect(result.rows).toEqual([
        { companyName: "Apex", _id: "VEN0001" },
      ]);
    } finally {
      await axis.close();
    }
  });

  it("omits _source when no axes are requested", async () => {
    const client = stubClient([{ companyName: "Apex", msme: "Yes" }]);
    const axis = makeAxis(client);
    try {
      await axis.searchDocuments({
        model: "Companies",
        search: { type: "fulltext", text: "Apex" },
      });
      expect("_source" in sentBody(client).body).toBe(false);
    } finally {
      await axis.close();
    }
  });
});
