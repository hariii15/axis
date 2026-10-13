import "dotenv/config";

import { afterAll, describe, expect, it } from "vitest";

import { Axis } from "../../src/core/axis.js";
import { registerModel } from "../../src/model/registry.js";
import { PurchaseRequisitions } from "../models/fixtures/purchase-requisitions.model.js";

registerModel(PurchaseRequisitions);

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not configured.",
  );
}

const axis = new Axis({
  database: {
    url: databaseUrl,
  },
});

describe("Axis query engine", () => {
  it("executes a complete query pipeline", async () => {
    const result = await axis.query({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      limit: 10,
    });

    expect(result.rows).toBeDefined();
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
  });
});

afterAll(async () => {
  await axis.close();
});