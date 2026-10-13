import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import { Axis, ModelRegistry } from "axis";

import { createApp, type AppContext } from "../src/app.js";
import { PurchaseRequisitions } from "../src/models/purchase-requisitions.js";

// ---------------------------------------------------------------------------
// PurchaseRequisitions — extensive model test
// ---------------------------------------------------------------------------
// Strategy (no live DB needed):
//   * UNREACHABLE_DB refuses connections instantly, so:
//       - a query that is VALID reaches execution  -> ExecutionError
//       - an unknown axis/metric/model fails first -> ResolutionError / Error("not registered")
//       - a malformed query fails first            -> ValidationError
//   * That lets us prove, for every name/shape, exactly WHERE it fails.
// ---------------------------------------------------------------------------

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";
const MODEL = "PurchaseRequisitions";

const EXPECTED_AXES = [
  "id",
  "status",
  "department",
  "createdBy",
  "amount",
  "createdAt",
  "hasAssignedBuyer",
] as const;

const EXPECTED_METRICS = ["newCount", "pendingCount", "assignedCount"] as const;

/** Fresh Axis with only PurchaseRequisitions registered. Caller must close(). */
function makeAxis(): Axis {
  const registry = new ModelRegistry();
  registry.register(PurchaseRequisitions);
  return new Axis({ database: { url: UNREACHABLE_DB }, registry });
}

async function expectExecutionError(input: unknown): Promise<void> {
  const axis = makeAxis();
  try {
    await axis.query(input);
    expect.unreachable(`expected ExecutionError for ${JSON.stringify(input)}`);
  } catch (err: any) {
    expect(err?.name).toBe("ExecutionError");
  } finally {
    await axis.close();
  }
}

async function expectResolutionError(
  input: unknown,
  messagePattern: RegExp,
): Promise<void> {
  const axis = makeAxis();
  try {
    await axis.query(input);
    expect.unreachable(`expected ResolutionError for ${JSON.stringify(input)}`);
  } catch (err: any) {
    expect(err?.name).toBe("ResolutionError");
    expect(err?.message).toMatch(messagePattern);
  } finally {
    await axis.close();
  }
}

async function expectValidationError(input: unknown): Promise<void> {
  const axis = makeAxis();
  try {
    await axis.query(input);
    expect.unreachable(`expected ValidationError for ${JSON.stringify(input)}`);
  } catch (err: any) {
    expect(err?.name).toBe("ValidationError");
    expect(Array.isArray(err?.issues)).toBe(true);
  } finally {
    await axis.close();
  }
}

// ===========================================================================
// A. Model definition integrity — importing / registering must never throw
// ===========================================================================
describe("A. model definition integrity (no runtime error on import/register)", () => {
  it("model is defined with the expected name", () => {
    expect(PurchaseRequisitions.name).toBe(MODEL);
  });

  it("source points at the requisitions table", () => {
    expect(PurchaseRequisitions.source).toEqual({
      type: "table",
      table: "upeg.requisition_deails",
    });
  });

  it("exposes exactly the expected axes", () => {
    expect(Object.keys(PurchaseRequisitions.axes).sort()).toEqual(
      [...EXPECTED_AXES].sort(),
    );
  });

  it("exposes exactly the expected metrics", () => {
    expect(Object.keys(PurchaseRequisitions.metrics).sort()).toEqual(
      [...EXPECTED_METRICS].sort(),
    );
  });

  it.each([
    ["id", "requisition_id", "string", true],
    ["status", "status", "number", false],
    ["department", "department_name", "string", false],
    ["createdBy", "created_by", "string", false],
    ["amount", "amount", "number", false],
    ["createdAt", "created_date", "time", false],
    ["hasAssignedBuyer", expect.any(String), "boolean", false],
  ] as Array<[string, unknown, string, boolean]>)(
    "axis '%s' has correct sql/type/primaryKey",
    (name, sql, type, primaryKey) => {
      const axis = (PurchaseRequisitions.axes as any)[name];
      expect(axis).toBeDefined();
      expect(axis.sql).toEqual(sql);
      expect(axis.type).toBe(type);
      if (primaryKey) expect(axis.primaryKey).toBe(true);
    },
  );

  it("hasAssignedBuyer axis is a boolean EXISTS sub-query", () => {
    const sql: string = (PurchaseRequisitions.axes as any).hasAssignedBuyer.sql;
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).toMatch(/requisition_item/i);
    expect(sql).toMatch(/last_buyer_assignment_date/i);
  });

  it("id is the only primary key", () => {
    const pks = Object.entries(PurchaseRequisitions.axes).filter(
      ([, a]: any) => (a as any).primaryKey === true,
    );
    expect(pks.map(([k]) => k)).toEqual(["id"]);
  });

  it.each([
    ["newCount", "count"],
    ["pendingCount", "count"],
    ["assignedCount", "count"],
  ])("metric '%s' has type '%s'", (name, type) => {
    expect((PurchaseRequisitions.metrics as any)[name].type).toBe(type);
  });

  it("newCount counts rows (no baked-in column, no baked-in filters)", () => {
    const m: any = (PurchaseRequisitions.metrics as any).newCount;
    expect(m.sql ?? null).toBeNull();
    expect(m.filters ?? []).toEqual([]);
  });

  it("pendingCount is pinned to status = 1", () => {
    expect((PurchaseRequisitions.metrics as any).pendingCount.filters).toEqual([
      { field: "status", operator: "equals", value: 1 },
    ]);
  });

  it("assignedCount is pinned to hasAssignedBuyer = true", () => {
    expect((PurchaseRequisitions.metrics as any).assignedCount.filters).toEqual([
      { field: "hasAssignedBuyer", operator: "equals", value: true },
    ]);
  });

  it("declares row-level security via upeg.get_requisitions_for_user(userId)", () => {
    expect(PurchaseRequisitions.security).toEqual({
      function: { name: "upeg.get_requisitions_for_user", args: ["userId"] },
    });
  });

  it("registers into a fresh ModelRegistry without throwing", () => {
    const registry = new ModelRegistry();
    expect(() => registry.register(PurchaseRequisitions)).not.toThrow();
    expect(registry.has(MODEL)).toBe(true);
    expect(registry.get(MODEL).name).toBe(MODEL);
  });

  it("registering twice throws 'already registered' (no silent overwrite)", () => {
    const registry = new ModelRegistry();
    registry.register(PurchaseRequisitions);
    expect(() => registry.register(PurchaseRequisitions)).toThrow(
      /already registered/i,
    );
  });
});

// ===========================================================================
// B. Metric name resolution — exact names pass, everything else says
//    `Metric "..." does not exist in model "PurchaseRequisitions"`
// ===========================================================================
describe("B. metric name resolution", () => {
  it.each([...EXPECTED_METRICS])(
    "metric '%s' is registered (reaches execution)",
    async (metric) => {
      await expectExecutionError({ model: MODEL, metrics: [metric] });
    },
  );

  it("all three metrics together are registered", async () => {
    await expectExecutionError({
      model: MODEL,
      metrics: ["newCount", "pendingCount", "assignedCount"],
    });
  });

  const badMetrics: Array<[string, unknown]> = [
    // the exact case from the bug report: wrong case
    ["lowercase pendingcount", "pendingcount"],
    ["uppercase PENDINGCOUNT", "PENDINGCOUNT"],
    ["lowercase newcount", "newcount"],
    ["lowercase assignedcount", "assignedCount".toLowerCase()],
    ["snake_case pending_count", "pending_count"],
    ["partial 'pending'", "pending"],
    ["partial 'count'", "count"],
    ["typo 'pendnigCount'", "pendnigCount"],
    ["trailing space", "pendingCount "],
    ["leading space", " pendingCount"],
    ["ghost metric", "NoSuchMetric"],
    ["sql injection attempt", "newCount; DROP TABLE x"],
  ];

  // NOTE: "" never reaches resolution — the validator rejects empty strings
  // first (ValidationError). Everything else reaches the resolver.
  it("empty-string metric fails at validation, before resolution", async () => {
    await expectValidationError({ model: MODEL, metrics: [""] });
  });

  it.each(badMetrics)("%s -> ResolutionError 'does not exist'", async (_label, metric) => {
    await expectResolutionError(
      { model: MODEL, metrics: [metric] },
      new RegExp(`Metric "${String(metric)}" does not exist in model "${MODEL}"`),
    );
  });

  it("one bad metric poisons the whole query even if others are valid", async () => {
    await expectResolutionError(
      { model: MODEL, metrics: ["newCount", "pendingcount"] },
      /Metric "pendingcount" does not exist/,
    );
  });

  it("metric names are case-sensitive: 'PendingCount' !== 'pendingCount'", async () => {
    await expectResolutionError(
      { model: MODEL, metrics: ["PendingCount"] },
      /Metric "PendingCount" does not exist/,
    );
  });

  it("duplicate valid metrics still resolve (reach execution)", async () => {
    await expectExecutionError({
      model: MODEL,
      metrics: ["newCount", "newCount"],
    });
  });
});

// ===========================================================================
// C. Axis name resolution
// ===========================================================================
describe("C. axis name resolution", () => {
  it.each([...EXPECTED_AXES])(
    "axis '%s' is registered (reaches execution)",
    async (axisName) => {
      await expectExecutionError({ model: MODEL, axes: [axisName] });
    },
  );

  const badAxes: Array<[string, unknown]> = [
    ["lowercase businessunit", "businessunit"],
    ["snake_case department_name (raw column, not axis)", "department_name"],
    ["raw column requisition_id", "requisition_id"],
    ["raw column status is ok as axis, but 'STATUS' is not", "STATUS"],
    ["typo 'departmemt'", "departmemt"],
    ["ghost axis", "nope"],
    ["metric name used as axis", "newCount"],
  ];

  // NOTE: "" never reaches resolution — the validator rejects empty strings
  // first (ValidationError).
  it("empty-string axis fails at validation, before resolution", async () => {
    await expectValidationError({
      model: MODEL,
      axes: [""],
      metrics: ["newCount"],
    });
  });

  it.each(badAxes)("%s -> ResolutionError 'does not exist'", async (_label, axisName) => {
    await expectResolutionError(
      { model: MODEL, axes: [axisName], metrics: ["newCount"] },
      new RegExp(`Axis "${String(axisName)}" does not exist in model "${MODEL}"`),
    );
  });

  it("axis names are case-sensitive: 'Department' !== 'department'", async () => {
    await expectResolutionError(
      { model: MODEL, axes: ["Department"], metrics: ["newCount"] },
      /Axis "Department" does not exist/,
    );
  });

  it("mixing one bad axis with valid ones still fails", async () => {
    await expectResolutionError(
      { model: MODEL, axes: ["department", "ghost"], metrics: ["newCount"] },
      /Axis "ghost" does not exist/,
    );
  });
});

// ===========================================================================
// D. orderBy field resolution
// ===========================================================================
describe("D. orderBy field resolution", () => {
  it.each([
    ["order by selected metric desc", "pendingCount"],
    ["order by selected metric asc", "newCount"],
    ["order by selected axis", "department"],
  ])("%s resolves (reaches execution)", async (_label, field) => {
    const isMetric = (EXPECTED_METRICS as readonly string[]).includes(field);
    await expectExecutionError({
      model: MODEL,
      ...(isMetric ? { metrics: [field] } : { axes: [field] }),
      orderBy: [{ field, direction: "desc" }],
    });
  });

  it("ordering by 'pendingcount' (wrong case) says it does not exist", async () => {
    await expectResolutionError(
      {
        model: MODEL,
        metrics: ["pendingCount"],
        orderBy: [{ field: "pendingcount", direction: "desc" }],
      },
      /Order field "pendingcount" does not exist/,
    );
  });

  it("ordering by an unknown field says it does not exist", async () => {
    await expectResolutionError(
      {
        model: MODEL,
        metrics: ["newCount"],
        orderBy: [{ field: "ghost", direction: "asc" }],
      },
      /Order field "ghost" does not exist/,
    );
  });

  // NOTE: orderBy is resolved against the MODEL, not against the selection —
  // ordering by a valid but unselected axis is allowed (reaches execution).
  it("ordering by a valid but unselected axis is allowed (reaches execution)", async () => {
    await expectExecutionError({
      model: MODEL,
      metrics: ["newCount"],
      orderBy: [{ field: "department", direction: "asc" }],
    });
  });
});

// ===========================================================================
// E. Model name resolution
// ===========================================================================
describe("E. model name resolution", () => {
  it("registered model name reaches execution", async () => {
    await expectExecutionError({ model: MODEL, metrics: ["newCount"] });
  });

  it.each([
    ["lowercase purchaserequisitions", "purchaserequisitions"],
    ["uppercase", "PURCHASEREQUISITIONS"],
    ["typo singular", "PurchaseRequisition"],
    ["ghost model", "GhostModel"],
  ])("%s -> 'not registered'", async (_label, model) => {
    const axis = makeAxis();
    try {
      await axis.query({ model, metrics: ["newCount"] });
      expect.unreachable(`expected 'not registered' for model ${model}`);
    } catch (err: any) {
      expect(String(err?.message)).toMatch(/not registered/i);
    } finally {
      await axis.close();
    }
  });

  // NOTE: "" never reaches the registry — the validator rejects it first.
  it("empty-string model fails at validation, before registry lookup", async () => {
    await expectValidationError({ model: "", metrics: ["newCount"] });
  });

  it("model names are case-sensitive", async () => {
    const axis = makeAxis();
    try {
      await expect(axis.query({ model: "PURCHASEREQUISITIONS", metrics: ["newCount"] }))
        .rejects.toThrow(/not registered/i);
    } finally {
      await axis.close();
    }
  });

  it("querying an empty registry always says 'not registered'", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      registry: new ModelRegistry(),
    });
    try {
      await expect(
        axis.query({ model: MODEL, metrics: ["newCount"] }),
      ).rejects.toThrow(/not registered/i);
    } finally {
      await axis.close();
    }
  });
});

// ===========================================================================
// F. Valid query matrix for this model — all must reach execution
// ===========================================================================
describe("F. valid queries against PurchaseRequisitions reach execution", () => {
  const valid: Array<[string, unknown]> = [
    ["axes only", { model: MODEL, axes: ["department"] }],
    ["every axis at once", { model: MODEL, axes: [...EXPECTED_AXES] }],
    ["metrics only", { model: MODEL, metrics: ["newCount"] }],
    ["axes + metrics", { model: MODEL, axes: ["department"], metrics: ["newCount", "pendingCount"] }],
    ["each axis x each metric", { model: MODEL, axes: ["department"], metrics: ["assignedCount"] }],
    ["boolean axis grouped", { model: MODEL, axes: ["hasAssignedBuyer"], metrics: ["assignedCount"] }],
    ["time axis grouped", { model: MODEL, axes: ["createdAt"], metrics: ["newCount"] }],
    ["equals filter on number axis", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "equals", value: 1 }] }],
    ["equals filter on boolean axis", { model: MODEL, metrics: ["assignedCount"], filters: [{ field: "hasAssignedBuyer", operator: "equals", value: true }] }],
    ["in filter", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "in", value: [1, 2] }] }],
    ["notIn filter", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "notIn", value: [0, 9] }] }],
    ["contains filter on text axis", { model: MODEL, axes: ["department"], filters: [{ field: "department", operator: "contains", value: "sales" }] }],
    ["startsWith filter", { model: MODEL, axes: ["department"], filters: [{ field: "department", operator: "startsWith", value: "Eng" }] }],
    ["isNull filter (no value)", { model: MODEL, metrics: ["newCount"], filters: [{ field: "department", operator: "isNull" }] }],
    ["isNotNull filter (no value)", { model: MODEL, metrics: ["newCount"], filters: [{ field: "department", operator: "isNotNull" }] }],
    ["multiple filters AND-ed", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "equals", value: 1 }, { field: "department", operator: "equals", value: "Retail" }] }],
    ["orderBy metric desc", { model: MODEL, metrics: ["pendingCount"], orderBy: [{ field: "pendingCount", direction: "desc" }] }],
    ["orderBy axis asc", { model: MODEL, axes: ["department"], orderBy: [{ field: "department", direction: "asc" }] }],
    ["limit only", { model: MODEL, metrics: ["newCount"], limit: 5 }],
    ["limit + offset", { model: MODEL, metrics: ["newCount"], limit: 5, offset: 10 }],
    ["offset zero", { model: MODEL, metrics: ["newCount"], offset: 0 }],
    ["kitchen sink", { model: MODEL, axes: ["department"], metrics: ["pendingCount", "newCount"], filters: [{ field: "department", operator: "equals", value: "Retail" }], orderBy: [{ field: "pendingCount", direction: "desc" }], limit: 5, offset: 0 }],
  ];

  it.each(valid)("%s", async (_label, body) => {
    await expectExecutionError(body);
  });
});

// ===========================================================================
// G. Invalid shapes against this model — all must be ValidationError
// ===========================================================================
describe("G. invalid query shapes against PurchaseRequisitions", () => {
  const invalid: Array<[string, unknown]> = [
    ["empty object", {}],
    ["missing model", { metrics: ["newCount"] }],
    ["empty model", { model: "", metrics: ["newCount"] }],
    ["numeric model", { model: 42, metrics: ["newCount"] }],
    ["neither axes nor metrics", { model: MODEL }],
    ["empty axes and metrics", { model: MODEL, axes: [], metrics: [] }],
    ["axes not an array", { model: MODEL, axes: "department" }],
    ["axes with empty string", { model: MODEL, axes: [""] }],
    ["axes with non-string", { model: MODEL, axes: [42] }],
    ["metrics not an array", { model: MODEL, metrics: 7 }],
    ["metrics with empty string", { model: MODEL, metrics: [""] }],
    ["metrics with non-string", { model: MODEL, metrics: [42] }],
    ["filters not an array", { model: MODEL, metrics: ["newCount"], filters: {} }],
    ["filter missing field", { model: MODEL, metrics: ["newCount"], filters: [{ operator: "equals", value: 1 }] }],
    ["filter missing operator", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status" }] }],
    ["filter bad operator 'equal'", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "equal", value: 1 }] }],
    ["filter object value", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "equals", value: { a: 1 } }] }],
    ["filter mixed-type array value", { model: MODEL, metrics: ["newCount"], filters: [{ field: "status", operator: "in", value: [1, "two"] }] }],
    ["orderBy not an array", { model: MODEL, metrics: ["newCount"], orderBy: "newCount" }],
    ["orderBy missing direction", { model: MODEL, metrics: ["newCount"], orderBy: [{ field: "newCount" }] }],
    ["orderBy bad direction 'up'", { model: MODEL, metrics: ["newCount"], orderBy: [{ field: "newCount", direction: "up" }] }],
    ["orderBy empty field", { model: MODEL, metrics: ["newCount"], orderBy: [{ field: "", direction: "asc" }] }],
    ["limit zero", { model: MODEL, metrics: ["newCount"], limit: 0 }],
    ["limit negative", { model: MODEL, metrics: ["newCount"], limit: -5 }],
    ["limit fraction", { model: MODEL, metrics: ["newCount"], limit: 2.5 }],
    ["limit string", { model: MODEL, metrics: ["newCount"], limit: "10" }],
    ["offset negative", { model: MODEL, metrics: ["newCount"], offset: -1 }],
    ["offset fraction", { model: MODEL, metrics: ["newCount"], offset: 1.5 }],
    ["offset string", { model: MODEL, metrics: ["newCount"], offset: "0" }],
  ];

  it.each(invalid)("%s -> ValidationError", async (_label, body) => {
    await expectValidationError(body);
  });
});

// ===========================================================================
// H. HTTP layer for this model — status codes + envelopes
// ===========================================================================
describe("H. HTTP layer for PurchaseRequisitions", () => {
  let ctx: AppContext;
  let baseUrl = "";

  beforeAll(async () => {
    ctx = createApp(UNREACHABLE_DB);
    const server = ctx.app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    (globalThis as any).__prTestServer = server;
  });

  afterAll(async () => {
    await ctx.axis.close();
    (globalThis as any).__prTestServer.close();
  });

  async function post(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  it("GET /models lists PurchaseRequisitions with all axes and metrics", async () => {
    const res = await fetch(`${baseUrl}/models`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    const pr = json.data.find((m: any) => m.name === MODEL);
    expect(pr).toBeDefined();
    expect([...pr.axes].sort()).toEqual([...EXPECTED_AXES].sort());
    expect([...pr.metrics].sort()).toEqual([...EXPECTED_METRICS].sort());
  });

  it("POST /search with 'pendingcount' (wrong case) returns 422 'does not exist'", async () => {
    const { status, json } = await post("/search", {
      model: MODEL,
      metrics: ["pendingcount"],
    });
    expect(status).toBe(422);
    expect(json.error.message).toMatch(/Metric "pendingcount" does not exist/);
  });

  it.each([...EXPECTED_METRICS])(
    "POST /search with metric '%s' is valid (502 = reached execution, no DB)",
    async (metric) => {
      const { status, json } = await post("/search", {
        model: MODEL,
        metrics: [metric],
      });
      expect(status).toBe(502);
      expect(json.error.code).toBe("ExecutionError");
    },
  );

  it("POST /search with unknown axis returns 422", async () => {
    const { status, json } = await post("/search", {
      model: MODEL,
      axes: ["ghost"],
      metrics: ["newCount"],
    });
    expect(status).toBe(422);
    expect(json.error.message).toMatch(/Axis "ghost" does not exist/);
  });

  it("POST /search/:model fills the model from the path", async () => {
    const { status, json } = await post(`/search/${MODEL}`, {
      metrics: ["pendingCount"],
    });
    expect(status).toBe(502); // reached execution => model + metric resolved
    expect(json.error.code).toBe("ExecutionError");
  });

  it("POST /search/:model with wrong-case metric still returns 422", async () => {
    const { status } = await post(`/search/${MODEL}`, {
      metrics: ["pendingcount"],
    });
    expect(status).toBe(422);
  });

  it("POST /search with empty metrics is a 400 ValidationError, not a resolution error", async () => {
    const { status, json } = await post("/search", {
      model: MODEL,
      metrics: [],
    });
    expect(status).toBe(400);
    expect(json.error.code).toBe("ValidationError");
  });
});
