import { describe, expect, it } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileToOpenSearch } from "../../src/core/compiler/opensearch/index.js";

const PurchaseRequisitions = defineModel({
  name: "PurchaseRequisitions",
  source: {
    type: "table",
    table: "upeg.requisition_deails",
  },
  axes: {
    department: {
      sql: "department_name",
      type: "string",
    },
    status: {
      sql: "status",
      type: "number",
    },
    reqId: {
      sql: "requisition_id",
      type: "string",
      search: { exact: true },
    },
  },
  metrics: {
    newCount: {
      type: "count",
    },
    pendingCount: {
      type: "count",
      sql: "requisition_id",
      filters: [
        {
          field: "status",
          operator: "equals",
          value: 1,
        },
      ],
    },
    approvedCount: {
      type: "count",
      sql: "requisition_id",
      filters: [
        {
          field: "status",
          operator: "equals",
          value: 2,
        },
      ],
    },
    idCount: {
      type: "count",
      sql: "requisition_id",
      filters: [
        {
          field: "reqId",
          operator: "equals",
          value: "REQ-1",
        },
      ],
    },
    amountTotal: {
      type: "sum",
      sql: "amount",
    },
  },
});

function compileToDSL(input: unknown) {
  console.log("\n========== INPUT ==========");
  console.log(JSON.stringify(input, null, 2));

  const query = parseAxisQuery(input);
  console.log("\n---------- [1] AFTER VALIDATION (AxisQuery) ----------");
  console.log(JSON.stringify(query, null, 2));

  const ast = buildQueryAST(query);
  console.log("\n---------- [2] AFTER AST ----------");
  console.log(JSON.stringify(ast, null, 2));

  const resolved = resolveQuery(ast, PurchaseRequisitions);
  console.log("\n---------- [3] AFTER RESOLVER (ResolvedQuery) ----------");
  console.log(
    JSON.stringify(
      {
        model: resolved.model.name,
        axes: resolved.axes.map((a) => ({ name: a.name, sql: a.definition.sql, type: a.definition.type })),
        metrics: resolved.metrics.map((m) => ({ name: m.name, ...m.definition })),
        filters: resolved.filters.map((f) => f.node),
        orderBy: resolved.orderBy.map((o) => o.node),
        limit: resolved.limit,
        offset: resolved.offset,
      },
      null,
      2,
    ),
  );

  const dsl = compileToOpenSearch(resolved);
  console.log("\n---------- [4] AFTER OPENSEARCH COMPILER (DSL) ----------");
  console.log(JSON.stringify(dsl, null, 2));
  console.log("\n========================================\n");

  return dsl;
}

describe("OpenSearch Compiler", () => {
  it("compiles a metric-only query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });

    expect(result.index).toBe("PurchaseRequisitions");
    expect(result.body.query).toBeDefined();
    expect(result.body.size).toBe(100);
  });

  it("compiles axes and metrics", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
    });

    expect(result.index).toBe("PurchaseRequisitions");
    expect(result.body._source).toEqual(["department"]);
    expect(result.body.aggs).toBeDefined();
    expect(result.body.aggs?.["newCount"]).toBeDefined();
  });

  it("compiles a metric with sum aggregation", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["amountTotal"],
    });

    expect(result.body.aggs?.["amountTotal"]).toMatchObject({
      sum: { field: "amount" },
    });
  });

  it("compiles equals filter as term query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "equals", value: 1 }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      term: { status: 1 },
    });
  });

  it("compiles greaterThan filter as range query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "greaterThan", value: 5 }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      range: { status: { gt: 5 } },
    });
  });

  it("compiles in filter as terms query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "in", value: ["A", "B"] }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      terms: { "department.keyword": ["A", "B"] },
    });
  });

  it("compiles contains filter as match query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "contains", value: "sales" }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      match: { department: "sales" },
    });
  });

  it("compiles isNull filter", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "isNull" }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      bool: { must_not: { exists: { field: "department" } } },
    });
  });

  it("compiles isNotNull filter", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "isNotNull" }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      exists: { field: "department" },
    });
  });

  it("compiles notEquals filter", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "notEquals", value: 1 }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      bool: { must_not: { term: { status: 1 } } },
    });
  });

  it("compiles startsWith filter as prefix query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "startsWith", value: "sales" }],
    });

    expect(result.body.query.bool.filter).toContainEqual({
      prefix: { department: "sales" },
    });
  });

  it("compiles orderBy as sort", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      orderBy: [{ field: "newCount", direction: "desc" }],
    });

    expect(result.body.sort).toContainEqual({ newCount: { order: "desc" } });
  });

  it("compiles limit and offset", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      limit: 25,
      offset: 10,
    });

    expect(result.body.size).toBe(25);
    expect(result.body.from).toBe(10);
  });

  it("compiles metric filters into per-metric filter aggs (not the shared bool)", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["pendingCount"],
    });

    // Canned filters scope only their own metric: combining two filtered
    // metrics must not intersect them in the shared query.
    expect(JSON.stringify(result.body.query)).not.toContain("status");
    expect(result.body.aggs?.["pendingCount"]).toMatchObject({
      filter: { bool: { filter: [{ term: { status: 1 } }] } },
      aggs: { value: { value_count: { field: "requisition_id" } } },
    });
  });

  it("keeps two canned-filter metrics independent", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["pendingCount", "approvedCount"],
    });

    expect(JSON.stringify(result.body.query)).not.toContain("status");
    const aggs = result.body.aggs as Record<string, { filter: unknown }>;
    expect(aggs["pendingCount"].filter).toMatchObject({
      bool: { filter: [{ term: { status: 1 } }] },
    });
    expect(aggs["approvedCount"].filter).toMatchObject({
      bool: { filter: [{ term: { status: 2 } }] },
    });
  });

  it("uses exact keyword fields as-is (no .keyword suffix)", () => {
    const filtered = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["idCount"],
    });
    expect(
      JSON.stringify(
        (filtered.body.aggs as Record<string, unknown>)["idCount"],
      ),
    ).toContain('"term":{"reqId":"REQ-1"}');

    const grouped = compileToDSL({
      model: "PurchaseRequisitions",
      axes: ["reqId"],
      metrics: ["newCount"],
    });
    expect(grouped.body.aggs?.["reqId_terms"]).toMatchObject({
      terms: { field: "reqId" },
    });

    const sorted = compileToDSL({
      model: "PurchaseRequisitions",
      axes: ["reqId"],
      metrics: ["newCount"],
      orderBy: [{ field: "reqId", direction: "asc" }],
    });
    expect(sorted.body.sort).toContainEqual({ reqId: { order: "asc" } });
  });

  it("compiles a complete analytical query", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount", "pendingCount"],
      filters: [
        { field: "department", operator: "equals", value: "Chemical" },
      ],
      orderBy: [{ field: "newCount", direction: "desc" }],
      limit: 25,
      offset: 10,
    });

    expect(result.index).toBe("PurchaseRequisitions");
    expect(result.body.size).toBe(25);
    expect(result.body.from).toBe(10);
    expect(result.body._source).toEqual(["department"]);
    expect(result.body.aggs?.["newCount"]).toBeDefined();
    expect(result.body.aggs?.["pendingCount"]).toBeDefined();
    expect(result.body.sort).toBeDefined();
  });

  it("produces a valid index name from model name", () => {
    const result = compileToDSL({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });

    expect(result.index).toBe("PurchaseRequisitions");
  });
});
