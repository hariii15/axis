import { describe, expect, it } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileToOpenSearch } from "../../src/core/compiler/opensearch/index.js";
import { buildOpenSearchSecurityFilters } from "../../src/core/security/opensearch.js";
import { SecurityContextError } from "../../src/core/security/errors.js";
import type { AxisSecurityConfig } from "../../src/core/security/types.js";

const CONFIG: AxisSecurityConfig = {
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
    },
  },
};

const Model = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  axes: {
    department: { sql: "department_name", type: "string" },
  },
  metrics: {
    newCount: { type: "count" },
  },
  search: { index: "purchase-requisitions" },
});

function compile(input: unknown, securityFilters?: Record<string, unknown>[]) {
  const query = parseAxisQuery(input);
  const ast = buildQueryAST(query);
  const resolved = resolveQuery(ast, Model);
  return compileToOpenSearch(
    resolved,
    securityFilters !== undefined ? { securityFilters } : {},
  );
}

describe("Phase 5: security → OpenSearch", () => {
  it("builds term filters for tenant and user", () => {
    const filters = buildOpenSearchSecurityFilters(
      { tenant: "tenant-001", user: "hariharpradeep@gmail.com" },
      CONFIG,
    );
    expect(filters).toEqual([
      { term: { tenant_id: "tenant-001" } },
      { term: { created_by: "hariharpradeep@gmail.com" } },
    ]);
  });

  it("fails closed when a required value is missing", () => {
    expect(() =>
      buildOpenSearchSecurityFilters({ user: "a@b.com" }, CONFIG),
    ).toThrow(SecurityContextError);
  });

  it("skips missing optional mappings", () => {
    const filters = buildOpenSearchSecurityFilters(
      { tenant: "tenant-001" },
      {
        mappings: {
          tenant: {
            contextKey: "tenant",
            column: "tenant_id",
            sessionKey: "app.tenant_id",
            required: true,
          },
          department: {
            contextKey: "department",
            column: "department_name",
            sessionKey: "app.department",
            required: false,
          },
        },
      },
    );
    expect(filters).toEqual([{ term: { tenant_id: "tenant-001" } }]);
  });

  it("honors searchField override", () => {
    const filters = buildOpenSearchSecurityFilters(
      { tenant: "tenant-001" },
      {
        mappings: {
          tenant: {
            contextKey: "tenant",
            column: "tenant_id",
            sessionKey: "app.tenant_id",
            required: true,
            searchField: "tenant.keyword",
          },
        },
      },
    );
    expect(filters).toEqual([{ term: { "tenant.keyword": "tenant-001" } }]);
  });

  it("prepends security filters before query filters", () => {
    const securityFilters = buildOpenSearchSecurityFilters(
      { tenant: "tenant-001", user: "a@b.com" },
      CONFIG,
    );
    const result = compile(
      {
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
        filters: [{ field: "department", operator: "equals", value: "Eng" }],
      },
      securityFilters,
    );
    expect(result.body.query.bool.filter).toEqual([
      { term: { tenant_id: "tenant-001" } },
      { term: { created_by: "a@b.com" } },
      { term: { "department.keyword": "Eng" } },
    ]);
  });

  it("compiler without security filters is unchanged", () => {
    const result = compile({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(result.body.query).toEqual({ bool: {} });
  });
});
