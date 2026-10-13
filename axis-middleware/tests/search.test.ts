import { afterAll, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";

import { createApp, type AppContext } from "../src/app.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

function makeSearch() {
  return {
    name: "fake-search",
    search: vi.fn(async () => ({
      hits: [
        {
          _index: "purchase-requisitions",
          _id: "REQ-100",
          _score: 0.9,
          _source: { title: "GPU workstation" },
        },
      ],
      total: { value: 1, relation: "eq" as const },
      took: 1,
      timedOut: false,
    })),
    index: vi.fn(async () => ({})),
    deleteIndex: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

function makeEmbeddings() {
  return {
    name: "fake-embeddings",
    embed: vi.fn(async () => [0.1, 0.2]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
    getDimensions: () => 2,
    healthCheck: async () => true,
    close: async () => undefined,
  };
}

interface Started {
  ctx: AppContext;
  baseUrl: string;
  server: ReturnType<AppContext["app"]["listen"]>;
}

async function startApp(options: Parameters<typeof createApp>[1] = {}): Promise<Started> {
  const ctx = createApp(UNREACHABLE_DB, options);
  const server = ctx.app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { ctx, baseUrl: `http://127.0.0.1:${port}`, server };
}

async function post(s: Started, path: string, body: unknown) {
  const res = await fetch(`${s.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /search without a search adapter", () => {
  let s: Started;
  afterAll(async () => {
    await s.ctx.axis.close();
    s.server.close();
  });

  it("returns 502 when search is not configured", async () => {
    s = await startApp();
    const { status, json } = await post(s, "/search", {
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: "chairs" },
    });
    expect(status).toBe(502);
    expect(json.error.code).toBe("ExecutionError");
  });

  it("validates the search shape (400)", async () => {
    const { status, json } = await post(s, "/search", {
      model: "PurchaseRequisitions",
      search: { type: "keyword", text: "" },
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("ValidationError");
  });
});

describe("POST /search with fake adapter + embeddings", () => {
  let s: Started;
  const search = makeSearch();
  const embeddings = makeEmbeddings();
  afterAll(async () => {
    await s.ctx.axis.close();
    s.server.close();
  });

  it("returns normalized rows with _id and _score", async () => {
    s = await startApp({
      searchAdapter: search as never,
      embeddingProviderInstance: embeddings as never,
    });
    expect(s.ctx.searchBackendKind).toBe("opensearch");
    expect(s.ctx.embeddingsBackendKind).toBe("custom");

    const { status, json } = await post(s, "/search", {
      model: "PurchaseRequisitions",
      search: { type: "semantic", text: "ML infrastructure" },
      limit: 5,
    });
    expect(status).toBe(200);
    expect(json.data.rows).toEqual([
      { title: "GPU workstation", _id: "REQ-100", _score: 0.9 },
    ]);
    expect(json.data.rowCount).toBe(1);
    expect(json.meta).toMatchObject({ model: "PurchaseRequisitions", limit: 5 });
    expect(embeddings.embed).toHaveBeenCalledWith("ML infrastructure");

    // Repeat executes again — caching is disabled in the middleware.
    await post(s, "/search", {
      model: "PurchaseRequisitions",
      search: { type: "semantic", text: "ML infrastructure" },
      limit: 5,
    });
    expect(search.search).toHaveBeenCalledTimes(2);
  });

  it("POST /search/:model fills in the model from the path", async () => {
    const { status } = await post(s, "/search/PurchaseRequisitions", {
      search: { type: "fulltext", text: "chairs" },
    });
    expect(status).toBe(200);
  });
});

describe("GET /os/indices", () => {
  it("returns 503 when search is not configured", async () => {
    const s = await startApp();
    try {
      const res = await fetch(`${s.baseUrl}/os/indices`);
      expect(res.status).toBe(503);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("SearchNotConfigured");
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });

  it("lists per-model index names with doc counts", async () => {
    const search = makeSearch();
    const s = await startApp({ searchAdapter: search as never });
    try {
      const res = await fetch(`${s.baseUrl}/os/indices`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data).toEqual([
        { model: "PurchaseRequisitions", index: "purchase-requisitions", docs: 1 },
        { model: "Companies", index: "companies", docs: 1 },
        { model: "CompanyInfo", index: "companyinfo", docs: 1 },
        { model: "ContactInfo", index: "contactinfo", docs: 1 },
        { model: "FinancialInfo", index: "financialinfo", docs: 1 },
      ]);
      // Counted via match_all with no hits fetched.
      expect(search.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "purchase-requisitions",
          query: { matchAll: {} },
          size: 0,
        }),
      );
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });
});

describe("GET /os/docs/:model", () => {
  it("returns 503 when search is not configured", async () => {
    const s = await startApp();
    try {
      const res = await fetch(`${s.baseUrl}/os/docs/PurchaseRequisitions`);
      expect(res.status).toBe(503);
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });

  it("returns 422 for an unknown model", async () => {
    const s = await startApp({ searchAdapter: makeSearch() as never });
    try {
      const res = await fetch(`${s.baseUrl}/os/docs/GhostModel`);
      expect(res.status).toBe(422);
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });

  it("returns sample docs with vectors truncated", async () => {
    const vector = Array.from({ length: 30 }, (_, i) => i * 0.01);
    const search = {
      ...makeSearch(),
      search: vi.fn(async () => ({
        hits: [
          {
            _index: "purchase-requisitions",
            _id: "REQ-001",
            _source: { department: "Engineering", embedding: vector },
          },
        ],
        total: { value: 8, relation: "eq" as const },
        took: 2,
        timedOut: false,
      })),
    };
    const s = await startApp({ searchAdapter: search as never });
    try {
      const res = await fetch(`${s.baseUrl}/os/docs/PurchaseRequisitions?limit=5`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.rowCount).toBe(1);
      expect(json.meta).toMatchObject({
        model: "PurchaseRequisitions",
        index: "purchase-requisitions",
        total: 8,
        limit: 5,
        offset: 0,
      });
      expect(json.data.rows).toEqual([
        {
          department: "Engineering",
          embedding: { truncated: true, length: 30, preview: vector.slice(0, 8) },
          _id: "REQ-001",
        },
      ]);
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });

  it("requires auth when a secret is set and tenant-filters samples", async () => {
    const search = makeSearch();
    const secret = "os-inspect-secret";
    const s = await startApp({ searchAdapter: search as never, jwtSecret: secret });
    try {
      const anon = await fetch(`${s.baseUrl}/os/docs/PurchaseRequisitions`);
      expect(anon.status).toBe(401);

      const { default: jwt } = await import("jsonwebtoken");
      const token = jwt.sign(
        { sub: "alice@example.com", tenantId: "tenant-001", roles: ["MANAGER"] },
        secret,
      );
      const res = await fetch(`${s.baseUrl}/os/docs/PurchaseRequisitions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const sentQuery = (search.search.mock.calls[0]?.[0] as any)?.query;
      const filters = JSON.stringify(sentQuery?.bool?.filter ?? []);
      expect(filters).toContain("tenant-001");
      expect(filters).toContain("alice@example.com");
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });

  it("shared-catalog model skips tenant filters on /os/docs/:model", async () => {
    const search = makeSearch();
    const secret = "os-inspect-secret";
    const s = await startApp({ searchAdapter: search as never, jwtSecret: secret });
    try {
      const { default: jwt } = await import("jsonwebtoken");
      const token = jwt.sign(
        { sub: "alice@example.com", tenantId: "tenant-001", roles: ["MANAGER"] },
        secret,
      );
      const res = await fetch(`${s.baseUrl}/os/docs/Companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.data.rowCount).toBe(1);
      const sentQuery = (search.search.mock.calls[0]?.[0] as any)?.query;
      expect(JSON.stringify(sentQuery)).not.toContain("tenant-001");
      expect(JSON.stringify(sentQuery)).not.toContain("alice@example.com");
    } finally {
      await s.ctx.axis.close();
      s.server.close();
    }
  });
});
