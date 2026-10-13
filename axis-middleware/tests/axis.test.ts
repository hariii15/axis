import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import { Axis, ModelRegistry, defineModel } from "axis";

import { createApp, type AppContext } from "../src/app.js";

// ---------------------------------------------------------------------------
// What this file proves
// ---------------------------------------------------------------------------
// 1. A model WITHOUT primaryKey is accepted (not a bug — see Section A).
//    The validator only checks the *query* shape; `defineModel` does not
//    validate models at all, and `primaryKey` is optional metadata.
// 2. Unregistered models never execute — they fail before any backend is touched.
// 3. Every invalid query shape fails with ValidationError (HTTP 400).
// 4. Unknown axes / metrics / order fields fail with 422 (never execute).
// 5. Broken metric definitions fail at compile time with 422.
// 6. Valid queries reach execution; without a search adapter that means 502.
//    (Middleware HTTP is OpenSearch-only: these go through POST /search.)
// 7. The success envelope, /health, /models and 404 all behave.
// ---------------------------------------------------------------------------

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

let ctx: AppContext;
let baseUrl = "";

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  ctx = createApp(UNREACHABLE_DB);
  const server = ctx.app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  (globalThis as any).__testServer = server;
});

afterAll(async () => {
  await ctx.axis.close();
  (globalThis as any).__testServer.close();
});

// ===========================================================================
// A. primaryKey is optional — a model without it still runs (NOT a bug)
// ===========================================================================
describe("A. model without primaryKey", () => {
  const NoPkModel = defineModel({
    name: "NoPkModel",
    source: { type: "table", table: "public.orders" },
    axes: {
      // NOTE: no axis here sets primaryKey: true
      status: { sql: "status", type: "string" },
      region: { sql: "region", type: "string" },
    },
    metrics: {
      total: { type: "count" },
    },
  });

  it("defineModel accepts a model with no primaryKey and returns it", () => {
    expect(NoPkModel.name).toBe("NoPkModel");
    expect(NoPkModel.axes.status).toBeDefined();
  });

  it("registers without throwing", () => {
    const registry = new ModelRegistry();
    expect(() => registry.register(NoPkModel)).not.toThrow();
    expect(registry.has("NoPkModel")).toBe(true);
  });

  it("passes validation, resolution and compilation (fails only at execution without DB)", async () => {
    const registry = new ModelRegistry();
    registry.register(NoPkModel);
    const axis = new Axis({ database: { url: UNREACHABLE_DB }, registry });
    try {
      await axis.query({ model: "NoPkModel", metrics: ["total"], limit: 1 });
      expect.unreachable("expected the query to fail at execution (no DB)");
    } catch (err: any) {
      // The whole point: it got PAST validation / resolution / compilation.
      expect(["ValidationError", "ResolutionError", "CompilationError"]).not.toContain(
        err?.name,
      );
      expect(err?.name).toBe("ExecutionError");
    } finally {
      await axis.close();
    }
  });

  it("behaves identically to a model WITH primaryKey (same failure stage)", async () => {
    const WithPk = defineModel({
      name: "WithPkModel",
      source: { type: "table", table: "public.orders" },
      axes: {
        id: { sql: "id", type: "string", primaryKey: true },
        status: { sql: "status", type: "string" },
      },
      metrics: { total: { type: "count" } },
    });
    const registry = new ModelRegistry();
    registry.register(WithPk);
    const axis = new Axis({ database: { url: UNREACHABLE_DB }, registry });
    try {
      await axis.query({ model: "WithPkModel", metrics: ["total"], limit: 1 });
      expect.unreachable("expected the query to fail at execution (no DB)");
    } catch (err: any) {
      expect(err?.name).toBe("ExecutionError");
    } finally {
      await axis.close();
    }
  });
});

// ===========================================================================
// B. unregistered model — never executes
// ===========================================================================
describe("B. unregistered model", () => {
  it("axis.query with an unknown model throws 'not registered'", async () => {
    await expect(
      ctx.axis.query({ model: "GhostModel", metrics: ["total"] }),
    ).rejects.toThrow(/not registered/i);
  });

  it("POST /search with an unknown model returns 422", async () => {
    const { status, json } = await post("/search", {
      model: "GhostModel",
      metrics: ["total"],
    });
    expect(status).toBe(422);
    expect(json.error.message).toMatch(/not registered/i);
  });

  it("POST /search/:model with an unknown model returns 422", async () => {
    const { status } = await post("/search/GhostModel", { metrics: ["total"] });
    expect(status).toBe(422);
  });

  it("querying an empty registry always fails", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: new ModelRegistry(),
    });
    try {
      await expect(
        axis.query({ model: "PurchaseRequisitions", metrics: ["newCount"] }),
      ).rejects.toThrow(/not registered/i);
    } finally {
      await axis.close();
    }
  });
});

// ===========================================================================
// C. validator — every invalid query shape throws ValidationError (HTTP 400)
// ===========================================================================
describe("C. invalid query shapes return 400 ValidationError", () => {
  const cases: Array<[string, unknown]> = [
    ["empty object", {}],
    // NOTE: `null` and plain strings never reach the validator — express.json()
    // rejects them while parsing (see "malformed JSON" test below).
    ["array body", []],
    ["missing model", { metrics: ["newCount"] }],
    ["empty model", { model: "", metrics: ["newCount"] }],
    ["numeric model", { model: 42, metrics: ["newCount"] }],
    ["neither axes nor metrics", { model: "PurchaseRequisitions" }],
    ["empty axes and metrics", { model: "PurchaseRequisitions", axes: [], metrics: [] }],
    ["axes not an array", { model: "PurchaseRequisitions", axes: "department" }],
    ["axes with empty string", { model: "PurchaseRequisitions", axes: [""] }],
    ["metrics not an array", { model: "PurchaseRequisitions", metrics: 7 }],
    ["metrics with empty string", { model: "PurchaseRequisitions", metrics: [""] }],
    ["filters not an array", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: {} }],
    ["filter missing field", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ operator: "equals", value: 1 }] }],
    ["filter missing operator", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status" }] }],
    ["filter bad operator", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "equal", value: 1 }] }],
    ["filter object value", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "equals", value: { a: 1 } }] }],
    ["filter mixed array value", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "in", value: [1, "two"] }] }],
    ["orderBy not an array", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: "newCount" }],
    ["orderBy missing direction", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: [{ field: "newCount" }] }],
    ["orderBy bad direction", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: [{ field: "newCount", direction: "up" }] }],
    ["orderBy empty field", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: [{ field: "", direction: "asc" }] }],
    ["limit zero", { model: "PurchaseRequisitions", metrics: ["newCount"], limit: 0 }],
    ["limit negative", { model: "PurchaseRequisitions", metrics: ["newCount"], limit: -5 }],
    ["limit fraction", { model: "PurchaseRequisitions", metrics: ["newCount"], limit: 2.5 }],
    ["limit string", { model: "PurchaseRequisitions", metrics: ["newCount"], limit: "10" }],
    ["offset negative", { model: "PurchaseRequisitions", metrics: ["newCount"], offset: -1 }],
    ["offset fraction", { model: "PurchaseRequisitions", metrics: ["newCount"], offset: 1.5 }],
  ];

  it.each(cases)("%s", async (_label, body) => {
    const { status, json } = await post("/search", body);
    expect(status).toBe(400);
    expect(json.error.code).toBe("ValidationError");
    expect(Array.isArray(json.error.issues)).toBe(true);
    expect(json.error.issues.length).toBeGreaterThan(0);
  });

  it("malformed JSON returns 400 InvalidJson (rejected by body parser)", async () => {
    const res = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("InvalidJson");
  });

  it("axis.query throws ValidationError (with issues) for a bad query", async () => {
    try {
      await ctx.axis.query({ model: "PurchaseRequisitions" });
      expect.unreachable("expected ValidationError");
    } catch (err: any) {
      expect(err?.name).toBe("ValidationError");
      expect(Array.isArray(err?.issues)).toBe(true);
    }
  });
});

// ===========================================================================
// D. resolution — unknown axes / metrics / order fields return 422
// ===========================================================================
describe("D. unknown axes, metrics and order fields return 422", () => {
  it.each([
    ["unknown axis", { model: "PurchaseRequisitions", axes: ["nope"], metrics: ["newCount"] }],
    ["unknown metric", { model: "PurchaseRequisitions", metrics: ["nope"] }],
    ["unknown order field", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: [{ field: "nope", direction: "asc" }] }],
    ["order by unknown axis", { model: "PurchaseRequisitions", axes: ["department"], orderBy: [{ field: "ghost", direction: "desc" }] }],
  ])("%s", async (_label, body) => {
    const { status, json } = await post("/search", body);
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toMatch(/does not exist|not registered/i);
  });

  it("filter on an unknown field is rejected at resolution (filters are resolved)", async () => {
    // Filters are resolved against owning models (required for cross-model
    // refs like `ContactInfo.email`), so an unknown field is a 422 —
    // it never reaches execution.
    const { status, json } = await post("/search", {
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "whatever", operator: "equals", value: 1 }],
    });
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toMatch(/does not exist|not registered/i);
  });
});

// ===========================================================================
// E. compilation — broken metric definitions fail before execution (422)
// ===========================================================================
describe("E. broken metric definitions return 422 CompilationError", () => {
  it("countDistinct without sql throws CompilationError (direct)", async () => {
    const Bad = defineModel({
      name: "BadModel",
      source: { type: "table", table: "public.t" },
      axes: { status: { sql: "status", type: "string" } },
      metrics: { bad: { type: "countDistinct" } }, // missing required sql
    });
    const registry = new ModelRegistry();
    registry.register(Bad);
    const axis = new Axis({ database: { url: UNREACHABLE_DB }, registry });
    try {
      await expect(
        axis.query({ model: "BadModel", metrics: ["bad"] }),
      ).rejects.toThrow(/countDistinct/);
    } finally {
      await axis.close();
    }
  });

  it("sum without sql throws CompilationError (direct)", async () => {
    const Bad = defineModel({
      name: "BadSumModel",
      source: { type: "table", table: "public.t" },
      axes: { status: { sql: "status", type: "string" } },
      metrics: { bad: { type: "sum" } }, // missing required sql
    });
    const registry = new ModelRegistry();
    registry.register(Bad);
    const axis = new Axis({ database: { url: UNREACHABLE_DB }, registry });
    try {
      await expect(axis.query({ model: "BadSumModel", metrics: ["bad"] })).rejects.toThrow(
        /requires sql/,
      );
    } finally {
      await axis.close();
    }
  });
});

// ===========================================================================
// F. valid queries reach execution (502 without a live DB proves the
//    pipeline — validate, resolve, compile — passed)
// ===========================================================================
describe("F. valid queries reach execution", () => {
  const validBodies: Array<[string, unknown]> = [
    ["axes only", { model: "PurchaseRequisitions", axes: ["department"] }],
    ["metrics only", { model: "PurchaseRequisitions", metrics: ["newCount"] }],
    ["axes + metrics", { model: "PurchaseRequisitions", axes: ["department"], metrics: ["newCount", "pendingCount"] }],
    ["with equals filter", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "equals", value: 1 }] }],
    ["with in filter", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "in", value: [1, 2] }] }],
    ["with empty in filter", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "in", value: [] }] }],
    ["with isNull filter", { model: "PurchaseRequisitions", metrics: ["newCount"], filters: [{ field: "status", operator: "isNull" }] }],
    ["with contains filter", { model: "PurchaseRequisitions", axes: ["department"], filters: [{ field: "department", operator: "contains", value: "sales" }] }],
    ["with orderBy metric", { model: "PurchaseRequisitions", metrics: ["newCount"], orderBy: [{ field: "newCount", direction: "desc" }] }],
    ["with orderBy axis", { model: "PurchaseRequisitions", axes: ["department"], orderBy: [{ field: "department", direction: "asc" }] }],
    ["with limit + offset", { model: "PurchaseRequisitions", metrics: ["newCount"], limit: 5, offset: 10 }],
  ];

  it.each(validBodies)("%s compiles and attempts execution (502, no DB)", async (_label, body) => {
    const { status, json } = await post("/search", body);
    expect(status).toBe(502);
    expect(json.error.code).toBe("ExecutionError");
  });

  it("POST /search/:model fills in the model from the path", async () => {
    const { status, json } = await post("/search/PurchaseRequisitions", {
      metrics: ["newCount"],
    });
    expect(status).toBe(502); // reached execution => path model was accepted
    expect(json.error.code).toBe("ExecutionError");
  });

  it("POST /search/:model still validates the rest of the body", async () => {
    const { status, json } = await post("/search/PurchaseRequisitions", {
      metrics: ["NoSuchMetric"],
    });
    expect(status).toBe(422);
  });
});

// ===========================================================================
// G. success envelope (mocked execution) + infra endpoints
// ===========================================================================
describe("G. success envelope and infra endpoints", () => {
  it("returns { data: { rows, rowCount }, meta } on success", async () => {
    const spy = vi
      .spyOn(ctx.axis, "searchDocuments")
      .mockResolvedValue({ rows: [{ department: "Sales", newCount: 3 }], rowCount: 1 });
    try {
      const { status, json } = await post("/search", {
        model: "PurchaseRequisitions",
        axes: ["department"],
        metrics: ["newCount"],
        limit: 10,
        offset: 2,
      });
      expect(status).toBe(200);
      expect(json.data.rows).toEqual([{ department: "Sales", newCount: 3 }]);
      expect(json.data.rowCount).toBe(1);
      expect(json.meta).toMatchObject({ model: "PurchaseRequisitions", limit: 10, offset: 2 });
    } finally {
      spy.mockRestore();
    }
  });

  it("omits limit/offset from meta when not requested", async () => {
    const spy = vi.spyOn(ctx.axis, "searchDocuments").mockResolvedValue({ rows: [], rowCount: 0 });
    try {
      const { status, json } = await post("/search", {
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
      });
      expect(status).toBe(200);
      expect(json.meta).toEqual({
        model: "PurchaseRequisitions",
        architecture: "A2",
        datasource: "opensearch",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /models lists registered models with axes and metrics", async () => {
    const res = await fetch(`${baseUrl}/models`);
    expect(res.status).toBe(200);
    const json = await res.json();
    const names = json.data.map((m: any) => m.name);
    expect(names).toContain("PurchaseRequisitions");
    const pr = json.data.find((m: any) => m.name === "PurchaseRequisitions");
    expect(pr.axes).toContain("department");
    expect(pr.metrics).toContain("newCount");
  });

  it("unknown route returns 404 envelope", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("NotFound");
  });

  it("POST /query returns 404 (direct-SQL path removed; middleware is OpenSearch-only)", async () => {
    const { status, json } = await post("/query", {
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(status).toBe(404);
    expect(json.error.code).toBe("NotFound");
  });

  it("GET /search returns 404 (wrong method)", async () => {
    const res = await fetch(`${baseUrl}/search`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// H. registry unit behaviour
// ===========================================================================
describe("H. ModelRegistry behaviour", () => {
  it("duplicate register throws", () => {
    const registry = new ModelRegistry();
    const m = defineModel({
      name: "Dup",
      source: { type: "table", table: "public.t" },
      axes: { a: { sql: "a", type: "string" } },
      metrics: { c: { type: "count" } },
    });
    registry.register(m);
    expect(() => registry.register(m)).toThrow(/already registered/);
  });

  it("get/has/remove/clear/size/getAll work", () => {
    const registry = new ModelRegistry();
    expect(registry.size).toBe(0);
    expect(registry.has("X")).toBe(false);
    expect(() => registry.get("X")).toThrow(/not registered/);
    const m = defineModel({
      name: "X",
      source: { type: "table", table: "public.t" },
      axes: { a: { sql: "a", type: "string" } },
      metrics: { c: { type: "count" } },
    });
    registry.register(m);
    expect(registry.size).toBe(1);
    expect(registry.has("X")).toBe(true);
    expect(registry.get("X").name).toBe("X");
    expect(registry.getAll().length).toBe(1);
    expect(registry.remove("X")).toBe(true);
    expect(registry.has("X")).toBe(false);
    registry.register(m);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
