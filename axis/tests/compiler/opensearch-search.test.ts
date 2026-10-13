import { describe, expect, it } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileToOpenSearch } from "../../src/core/compiler/opensearch/index.js";
import { buildOpenSearchSecurityFilters } from "../../src/core/security/opensearch.js";

const Model = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
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
    embeddingField: "embedding",
  },
});

const SECURITY = {
  mappings: {
    tenant: {
      contextKey: "tenant",
      column: "tenant_id",
      sessionKey: "app.tenant_id",
      required: true,
    },
  },
};

const VECTOR = [0.1, 0.2, 0.3];

function compile(input: unknown, options: { vector?: number[] } = {}) {
  const query = parseAxisQuery(input);
  const ast = buildQueryAST(query);
  const resolved = resolveQuery(ast, Model);
  const securityFilters = buildOpenSearchSecurityFilters(
    { tenant: "tenant-001" },
    SECURITY,
  );
  return compileToOpenSearch(resolved, {
    securityFilters,
    ...(options.vector !== undefined ? { queryVector: options.vector } : {}),
  });
}

describe("Phase 9: semantic search DSL", () => {
  it("emits top-level knn with the query vector and k", () => {
    const result = compile(
      {
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "ML infrastructure" },
        limit: 5,
      },
      { vector: VECTOR },
    );
    expect(result.index).toBe("purchase-requisitions");
    expect(result.body.query).toEqual({
      knn: {
        embedding: {
          vector: VECTOR,
          k: 5,
          filter: { bool: { filter: [{ term: { tenant_id: "tenant-001" } }] } },
        },
      },
    });
    expect(result.body.size).toBe(5);
  });

  it("honors search.k over the limit", () => {
    const result = compile(
      {
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "x", k: 3 },
        limit: 25,
      },
      { vector: VECTOR },
    );
    expect(result.body.query).toMatchObject({
      knn: { embedding: { k: 3 } },
    });
  });

  it("throws for semantic search without a query vector", () => {
    expect(() =>
      compile({
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "x" },
      }),
    ).toThrow(/query vector/);
  });

  it("emits fulltext should-match clauses over searchable fields", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: "workstation" },
    });
    const bool = result.body.query.bool as {
      should: unknown[];
      filter: unknown[];
    };
    expect(bool.should).toContainEqual({ match: { title: "workstation" } });
    expect(bool.should).toContainEqual({ match: { dept: "workstation" } });
    expect(bool.filter).toContainEqual({ term: { tenant_id: "tenant-001" } });
    expect("knn" in result.body.query).toBe(false);
  });

  it("restricts fulltext fields to the requested axes", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: "x", fields: ["title"] },
    });
    const bool = result.body.query.bool as { should: unknown[] };
    expect(bool.should).toEqual([{ match: { title: "x" } }]);
  });

  it("emits hybrid knn plus text matches", () => {
    const result = compile(
      {
        model: "PurchaseRequisitions",
        search: { type: "hybrid", text: "GPU" },
      },
      { vector: VECTOR },
    );
    const bool = result.body.query.bool as {
      must: Array<{ knn: { embedding: { k: number } } }>;
      should: unknown[];
      filter: unknown[];
    };
    expect(bool.must[0]?.knn.embedding.k).toBe(100);
    expect(bool.should).toContainEqual({ match: { title: "GPU" } });
    expect(bool.filter).toContainEqual({ term: { tenant_id: "tenant-001" } });
  });

  it("rejects unknown search fields at resolution", () => {
    expect(() =>
      compile({
        model: "PurchaseRequisitions",
        search: { type: "fulltext", text: "x", fields: ["ghost"] },
      }),
    ).toThrow(/does not exist/);
  });
});

describe("Phase 9: search validation", () => {
  it("accepts a search-only query without axes or metrics", () => {
    const query = parseAxisQuery({
      model: "PurchaseRequisitions",
      search: { type: "semantic", text: "ML infrastructure" },
    });
    expect(query.search?.type).toBe("semantic");
  });

  it("rejects unknown search types and empty text", () => {
    expect(() =>
      parseAxisQuery({
        model: "PurchaseRequisitions",
        search: { type: "keyword", text: "x" },
      }),
    ).toThrow();
    expect(() =>
      parseAxisQuery({
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "" },
      }),
    ).toThrow();
  });

  it("rejects non-positive k", () => {
    expect(() =>
      parseAxisQuery({
        model: "PurchaseRequisitions",
        search: { type: "semantic", text: "x", k: 0 },
      }),
    ).toThrow();
  });
});
