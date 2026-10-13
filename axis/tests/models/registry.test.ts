import { describe, expect, it } from "vitest";

import {
  ModelRegistry,
  defaultModelRegistry,
  getModel,
  registerModel,
} from "../../src/model/registry.js";
import { defineModel } from "../../src/model/model.js";

describe("ModelRegistry", () => {
  const createModel = (name: string) =>
    defineModel({
      name,

      source: {
        type: "table",
        table: "test.table",
      },

      axes: {},

      metrics: {},
    });

  it("registers and retrieves a model", () => {
    const registry = new ModelRegistry();

    const model = createModel("PurchaseRequisitions");

    registry.register(model);

    expect(registry.get("PurchaseRequisitions")).toBe(model);
  });

  it("checks whether a model exists", () => {
    const registry = new ModelRegistry();

    registry.register(createModel("PurchaseRequisitions"));

    expect(registry.has("PurchaseRequisitions")).toBe(true);
    expect(registry.has("RFQs")).toBe(false);
  });

  it("rejects duplicate models", () => {
    const registry = new ModelRegistry();

    registry.register(createModel("PurchaseRequisitions"));

    expect(() => {
      registry.register(createModel("PurchaseRequisitions"));
    }).toThrow(
      'Model "PurchaseRequisitions" is already registered.',
    );
  });

  it("throws when retrieving an unknown model", () => {
    const registry = new ModelRegistry();

    expect(() => {
      registry.get("UnknownModel");
    }).toThrow(
      'Model "UnknownModel" is not registered.',
    );
  });

  it("removes a model", () => {
    const registry = new ModelRegistry();

    registry.register(createModel("PurchaseRequisitions"));

    expect(registry.remove("PurchaseRequisitions")).toBe(true);
    expect(registry.has("PurchaseRequisitions")).toBe(false);
  });

  it("returns all registered models", () => {
    const registry = new ModelRegistry();

    registry.register(createModel("PurchaseRequisitions"));
    registry.register(createModel("RFQs"));

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it("clears all models", () => {
    const registry = new ModelRegistry();

    registry.register(createModel("PurchaseRequisitions"));
    registry.register(createModel("RFQs"));

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.getAll()).toEqual([]);
  });

  describe("defaultModelRegistry & getModel helper", () => {
    it("registers and retrieves a model using getModel", () => {
      defaultModelRegistry.clear();
      const model = createModel("PurchaseRequisitions");

      registerModel(model);
      expect(getModel("PurchaseRequisitions")).toBe(model);
    });

    it("throws when getModel is called for an unregistered model", () => {
      defaultModelRegistry.clear();
      expect(() => getModel("MissingModel")).toThrow(
        'Model "MissingModel" is not registered.',
      );
    });
  });
});