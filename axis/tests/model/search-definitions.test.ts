import { describe, expect, it } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileToOpenSearch } from "../../src/core/compiler/opensearch/index.js";

const SearchModel = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
    department: {
      sql: "department_name",
      type: "string",
      search: { field: "dept", searchable: true },
    },
    title: { sql: "title", type: "string" },
  },
  metrics: {
    newCount: { type: "count" },
    amountTotal: {
      type: "sum",
      sql: "amount",
      search: { field: "total_amount" },
    },
  },
  search: {
    index: "purchase-requisitions",
    searchable: ["department", "title"],
    embeddingInput: ["title", "department"],
    embeddingField: "embedding",
  },
});

function compile(input: unknown) {
  const query = parseAxisQuery(input);
  const ast = buildQueryAST(query);
  const resolved = resolveQuery(ast, SearchModel);
  return compileToOpenSearch(resolved);
}

describe("Phase 4: model search definitions", () => {
  it("defineModel preserves the search section", () => {
    expect(SearchModel.search?.index).toBe("purchase-requisitions");
    expect(SearchModel.search?.searchable).toEqual(["department", "title"]);
    expect(SearchModel.search?.embeddingInput).toEqual(["title", "department"]);
    expect(SearchModel.search?.embeddingField).toBe("embedding");
  });

  it("uses search.index instead of model name", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(result.index).toBe("purchase-requisitions");
  });

  it("maps axis search.field into _source", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
    });
    expect(result.body._source).toEqual(["dept"]);
  });

  it("maps axis search.field into filters", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "department", operator: "equals", value: "Eng" }],
    });
    expect(result.body.query.bool.filter).toContainEqual({
      term: { "dept.keyword": "Eng" },
    });
  });

  it("maps axis search.field into terms agg and sort", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      orderBy: [{ field: "department", direction: "asc" }],
    });
    expect(result.body.aggs?.["department_terms"]).toMatchObject({
      terms: { field: "dept.keyword" },
    });
    expect(result.body.sort).toContainEqual({ "dept.keyword": { order: "asc" } });
  });

  it("maps metric search.field into aggs", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      metrics: ["amountTotal"],
    });
    expect(result.body.aggs?.["amountTotal"]).toMatchObject({
      sum: { field: "total_amount" },
    });
  });

  it("falls back to axis name when no search.field is set", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      axes: ["title"],
      metrics: ["newCount"],
    });
    expect(result.body._source).toContain("title");
  });

  it("falls back to model name when search section is absent", () => {
    const Plain = defineModel({
      name: "Plain",
      source: { type: "table", table: "public.t" },
      axes: { department: { sql: "department", type: "string" } },
      metrics: { total: { type: "count" } },
    });
    const query = parseAxisQuery({ model: "Plain", metrics: ["total"] });
    const ast = buildQueryAST(query);
    const resolved = resolveQuery(ast, Plain);
    const result = compileToOpenSearch(resolved);
    expect(result.index).toBe("Plain");
  });
});
