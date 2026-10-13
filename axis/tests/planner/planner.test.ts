import { describe, expect, it } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { DefaultQueryPlanner } from "../../src/core/planner/planner.js";
import { ExecutionTarget } from "../../src/core/planner/types.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

describe("Phase 6: DefaultQueryPlanner", () => {
  it("routes plain structured queries to PostgreSQL", async () => {
    const planner = new DefaultQueryPlanner();
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(plan.target).toBe(ExecutionTarget.POSTGRESQL);
    expect(plan.fallback).toContain(ExecutionTarget.OPENSEARCH);
  });

  it("routes semantic search to OpenSearch", async () => {
    const planner = new DefaultQueryPlanner();
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      search: { type: "semantic", text: "ML infrastructure" },
    });
    expect(plan.target).toBe(ExecutionTarget.OPENSEARCH);
    expect(plan.reason).toMatch(/vector/i);
  });

  it("routes hybrid search to OpenSearch", async () => {
    const planner = new DefaultQueryPlanner();
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      search: { type: "hybrid", text: "GPU workstation" },
    });
    expect(plan.target).toBe(ExecutionTarget.OPENSEARCH);
  });

  it("routes full-text search to OpenSearch", async () => {
    const planner = new DefaultQueryPlanner();
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      search: { type: "fulltext", text: "workstation" },
    });
    expect(plan.target).toBe(ExecutionTarget.OPENSEARCH);
  });

  it("honors custom rules by priority", async () => {
    const planner = new DefaultQueryPlanner({
      rules: [
        {
          name: "dashboard-precomputed",
          priority: 100,
          condition: (input) =>
            input.model === "PurchaseRequisitions" &&
            (input.metrics ?? []).includes("newCount"),
          target: ExecutionTarget.S3_STATISTICS,
        },
      ],
    });
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(plan.target).toBe(ExecutionTarget.S3_STATISTICS);
    expect(plan.reason).toMatch(/dashboard-precomputed/);
  });

  it("honors a custom defaultTarget", async () => {
    const planner = new DefaultQueryPlanner({
      defaultTarget: ExecutionTarget.OPENSEARCH,
    });
    const plan = await planner.plan({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    expect(plan.target).toBe(ExecutionTarget.OPENSEARCH);
  });

  it("is deterministic for the same input", async () => {
    const planner = new DefaultQueryPlanner();
    const input = {
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      search: { type: "semantic" as const, text: "ML infrastructure" },
    };
    const a = await planner.plan(input);
    const b = await planner.plan(input);
    expect(a).toEqual(b);
  });
});

describe("Phase 6: Axis.plan()", () => {
  it("exposes a default planner without config", async () => {
    const axis = new Axis({ database: { url: UNREACHABLE_DB } });
    try {
      expect(axis.planner).toBeDefined();
      const plan = await axis.plan({
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
      });
      expect(plan.target).toBe(ExecutionTarget.POSTGRESQL);
    } finally {
      await axis.close();
    }
  });

  it("accepts custom planner rules via config", async () => {
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      planner: {
        rules: [
          {
            name: "everything-to-search",
            priority: 10,
            condition: () => true,
            target: ExecutionTarget.OPENSEARCH,
          },
        ],
      },
    });
    try {
      const plan = await axis.plan({
        model: "PurchaseRequisitions",
        metrics: ["newCount"],
      });
      expect(plan.target).toBe(ExecutionTarget.OPENSEARCH);
    } finally {
      await axis.close();
    }
  });
});
