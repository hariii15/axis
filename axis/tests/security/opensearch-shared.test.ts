import { describe, expect, it, vi, afterEach } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { defineModel } from "../../src/model/model.js";
import { ModelRegistry } from "../../src/model/registry.js";
import { OpenSearchAdapter } from "../../src/core/search/OpenSearchAdapter.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const SECURITY = {
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
      searchField: "createdBy",
    },
  },
};

const SharedCatalog = defineModel({
  name: "Companies",
  source: { type: "table", table: "vendor_companies" },
  axes: {
    id: { sql: "company_id", type: "string", primaryKey: true },
    companyName: { sql: "company_name", type: "string" },
  },
  metrics: {
    totalCompanies: { type: "count" },
  },
  security: { openSearch: { shared: true } },
  search: { index: "companies", searchable: ["companyName"] },
});

const Scoped = defineModel({
  name: "Scoped",
  source: { type: "table", table: "scoped_things" },
  axes: {
    id: { sql: "id", type: "string", primaryKey: true },
  },
  metrics: {
    total: { type: "count" },
  },
  search: { index: "scoped-things", searchable: ["id"] },
});

function stubClient() {
  return {
    search: vi.fn(async () => ({
      body: {
        took: 1,
        timed_out: false,
        hits: { total: { value: 0, relation: "eq" }, hits: [] },
        aggregations: { total: { value: 0 }, totalCompanies: { value: 0 } },
      },
      statusCode: 200,
    })),
    index: vi.fn(async () => ({})),
    indices: { delete: vi.fn(async () => ({})) },
    cluster: { health: vi.fn(async () => ({ body: { status: "green" } })) },
    close: vi.fn(async () => undefined),
  };
}

function makeAxis(client: ReturnType<typeof stubClient>) {
  const registry = new ModelRegistry();
  registry.register(SharedCatalog);
  registry.register(Scoped);
  return new Axis({
    database: { url: UNREACHABLE_DB },
    registry,
    security: SECURITY,
    searchAdapter: new OpenSearchAdapter({
      url: "http://localhost:9200",
      client: client as never,
    }),
  });
}

const CONTEXT = { user: "alice@example.com", tenant: "tenant-001", roles: [] };

describe("shared-catalog models skip engine term filters", () => {
  it("Companies (shared) sends no tenant/user terms", async () => {
    const client = stubClient();
    const axis = makeAxis(client);
    try {
      await axis.searchDocuments(
        { model: "Companies", metrics: ["totalCompanies"] },
        { context: CONTEXT },
      );
      const sent = client.search.mock.calls[0]?.[0] as {
        body: { query: unknown };
      };
      const query = JSON.stringify(sent.body.query);
      expect(query).not.toContain("tenant-001");
      expect(query).not.toContain("alice@example.com");
    } finally {
      await axis.close();
    }
  });

  it("scoped models still send tenant/user terms", async () => {
    const client = stubClient();
    const axis = makeAxis(client);
    try {
      await axis.searchDocuments(
        { model: "Scoped", metrics: ["total"] },
        { context: CONTEXT },
      );
      const sent = client.search.mock.calls[0]?.[0] as {
        body: { query: unknown };
      };
      const query = JSON.stringify(sent.body.query);
      expect(query).toContain("tenant-001");
      expect(query).toContain("alice@example.com");
    } finally {
      await axis.close();
    }
  });
});
