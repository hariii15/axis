import { describe, expect, it } from "vitest";

import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";

import {
  resolveQuery,
} from "../../src/core/resolver/resolver.js";

import {
  ResolutionError,
} from "../../src/core/resolver/error.js";

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

    createdAt: {
      sql: "created_date",
      type: "time",
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

function resolve(input: unknown) {
  const query = parseAxisQuery(input);
  const ast = buildQueryAST(query);

  return resolveQuery(
    ast,
    PurchaseRequisitions,
  );
}

describe("Semantic Resolver", () => {
  it("resolves an axis", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
    });

    expect(result.axes).toHaveLength(1);
    expect(result.axes[0]?.name).toBe("department");

    expect(result.axes[0]?.definition).toEqual({
      sql: "department_name",
      type: "string",
    });
  });

  it("resolves a metric", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]?.name).toBe("newCount");

    expect(result.metrics[0]?.definition).toEqual({
      type: "count",
    });
  });

  it("resolves a metric with its internal filters", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      metrics: ["pendingCount"],
    });

    expect(result.metrics[0]?.definition.filters).toEqual([
      {
        field: "status",
        operator: "equals",
        value: 1,
      },
    ]);
  });

  it("resolves multiple axes and metrics", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      axes: [
        "department",
        "status",
      ],
      metrics: [
        "newCount",
        "pendingCount",
      ],
    });

    expect(result.axes.map((axis) => axis.name)).toEqual([
      "department",
      "status",
    ]);

    expect(result.metrics.map((metric) => metric.name)).toEqual([
      "newCount",
      "pendingCount",
    ]);
  });

  it("resolves filters", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [
        {
          field: "status",
          operator: "equals",
          value: 1,
        },
      ],
    });

    expect(result.filters).toHaveLength(1);

    expect(result.filters[0]?.node).toEqual({
      type: "filter",
      field: "status",
      operator: "equals",
      value: 1,
    });
  });

  it("resolves orderBy using an axis", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      orderBy: [
        {
          field: "department",
          direction: "asc",
        },
      ],
    });

    expect(result.orderBy[0]?.field.name).toBe(
      "department",
    );

    expect(
      result.orderBy[0]?.field.definition,
    ).toEqual({
      sql: "department_name",
      type: "string",
    });
  });

  it("resolves orderBy using a metric", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      orderBy: [
        {
          field: "newCount",
          direction: "desc",
        },
      ],
    });

    expect(result.orderBy[0]?.field.name).toBe(
      "newCount",
    );

    expect(
      result.orderBy[0]?.field.definition,
    ).toEqual({
      type: "count",
    });
  });

  it("preserves pagination", () => {
    const result = resolve({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      limit: 50,
      offset: 100,
    });

    expect(result.limit).toBe(50);
    expect(result.offset).toBe(100);
  });

  it("rejects an unknown axis", () => {
    const query = parseAxisQuery({
      model: "PurchaseRequisitions",
      axes: ["unknownAxis"],
    });

    const ast = buildQueryAST(query);

    expect(() =>
      resolveQuery(
        ast,
        PurchaseRequisitions,
      ),
    ).toThrow(ResolutionError);
  });

  it("rejects an unknown metric", () => {
    const query = parseAxisQuery({
      model: "PurchaseRequisitions",
      metrics: ["unknownMetric"],
    });

    const ast = buildQueryAST(query);

    expect(() =>
      resolveQuery(
        ast,
        PurchaseRequisitions,
      ),
    ).toThrow(ResolutionError);
  });

  it("rejects an unknown orderBy field", () => {
    const query = parseAxisQuery({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      orderBy: [
        {
          field: "unknown",
          direction: "desc",
        },
      ],
    });

    const ast = buildQueryAST(query);

    expect(() =>
      resolveQuery(
        ast,
        PurchaseRequisitions,
      ),
    ).toThrow(ResolutionError);
  });

  it("rejects a model mismatch", () => {
    const query = parseAxisQuery({
      model: "RFQs",
      metrics: ["newCount"],
    });

    const ast = buildQueryAST(query);

    expect(() =>
      resolveQuery(
        ast,
        PurchaseRequisitions,
      ),
    ).toThrow(
      'Query model "RFQs" does not match model "PurchaseRequisitions".',
    );
  });

  it("produces a complete resolved query", () => {
    const result = resolve({
      model: "PurchaseRequisitions",

      axes: [
        "department",
      ],

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
      offset: 10,
    });

    expect(result.model.name).toBe(
      "PurchaseRequisitions",
    );

    expect(result.axes[0]?.name).toBe(
      "department",
    );

    expect(result.metrics.map(
      (metric) => metric.name,
    )).toEqual([
      "newCount",
      "pendingCount",
    ]);

    expect(result.filters).toHaveLength(1);
    expect(result.orderBy).toHaveLength(1);

    expect(result.limit).toBe(25);
    expect(result.offset).toBe(10);
  });
});