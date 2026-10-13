import { describe, it, expect } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileQuery } from "../../src/core/compiler/compiler.js";

describe("Axis query pipeline", () => {
  it("runs JSON → Validator → AST → Resolver → SQL", () => {
    const input = {
      model: "PurchaseRequisitions",

      axes: ["department"],

      metrics: [
        "newCount",
        "pendingCount",
      ],

      filters: [
        {
          field: "status",
          operator: "equals",
          value: 1,
        },
      ],

      orderBy: [
        {
          field: "newCount",
          direction: "desc",
        },
      ],

      limit: 25,
      offset: 0,
    };

    const model = defineModel({
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
      },
    });

    console.log("\n========== INPUT ==========");
    console.dir(input, { depth: null });

    const query = parseAxisQuery(input);

    console.log("\n========== VALIDATED QUERY ==========");
    console.dir(query, { depth: null });

    const ast = buildQueryAST(query);

    console.log("\n========== AST ==========");
    console.dir(ast, { depth: null });

    const resolved = resolveQuery(ast, model);

    console.log("\n========== RESOLVED QUERY ==========");
    console.dir(resolved, { depth: null });

    const compiled = compileQuery(resolved);

    console.log("\n========== SQL ==========");
    console.log(compiled.sql);

    console.log("\n========== PARAMETERS ==========");
    console.dir(compiled.parameters, { depth: null });

    expect(compiled.sql).toBeDefined();
    expect(compiled.parameters).toBeDefined();
  });
});