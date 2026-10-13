import { describe, expect, it } from "vitest";

import { buildCacheKey } from "../../src/core/cache/key-builder.js";
import type { AxisQuery } from "../../src/core/query/types.js";

const BASE_QUERY: AxisQuery = {
  model: "PurchaseRequisitions",
  axes: ["department"],
  metrics: ["newCount"],
};

describe("buildCacheKey — key format", () => {
  it("produces `<prefix>:<Model>:<hex digest>` keys", () => {
    const key = buildCacheKey(BASE_QUERY);

    expect(key).toMatch(/^axis:PurchaseRequisitions:[0-9a-f]{64}$/);
  });

  it("supports a custom prefix", () => {
    const key = buildCacheKey(BASE_QUERY, { prefix: "axis:v2" });

    expect(key).toMatch(/^axis:v2:PurchaseRequisitions:[0-9a-f]{64}$/);
  });

  it("supports a custom hash algorithm", () => {
    const key = buildCacheKey(BASE_QUERY, { algorithm: "sha512" });

    expect(key).toMatch(/^axis:PurchaseRequisitions:[0-9a-f]{128}$/);
  });

  it("is deterministic for identical input", () => {
    expect(buildCacheKey(BASE_QUERY)).toBe(buildCacheKey(BASE_QUERY));
  });

  it("has fixed length regardless of query size", () => {
    const small = buildCacheKey(BASE_QUERY);
    const large = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["a", "b", "c", "d", "e"],
      metrics: ["m1", "m2", "m3"],
      filters: [
        { field: "status", operator: "in", value: [1, 2, 3, 4, 5] },
        { field: "department", operator: "contains", value: "sales" },
      ],
      orderBy: [{ field: "m1", direction: "desc" }],
      limit: 100,
      offset: 50,
    });

    expect(large.length).toBe(small.length);
  });

  it("sanitizes unsafe characters in the model segment", () => {
    const key = buildCacheKey({ ...BASE_QUERY, model: "my model:v2" });

    expect(key).toMatch(/^axis:my_model_v2:[0-9a-f]{64}$/);
  });

  it("sanitized models cannot collide when raw names differ", () => {
    // "a:b" sanitizes to "a_b" — the digest still covers the raw name,
    // so it can never equal the key for a genuine "a_b" model.
    const colon = buildCacheKey({ ...BASE_QUERY, model: "a:b" });
    const plain = buildCacheKey({ ...BASE_QUERY, model: "a_b" });

    expect(colon).not.toBe(plain);
    expect(colon).toMatch(/^axis:a_b:[0-9a-f]{64}$/);
    expect(plain).toMatch(/^axis:a_b:[0-9a-f]{64}$/);
  });
});

describe("buildCacheKey — semantic equivalence", () => {
  it("ignores axes ordering", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["department", "status"],
      metrics: ["newCount"],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["status", "department"],
      metrics: ["newCount"],
    });

    expect(key1).toBe(key2);
  });

  it("ignores metrics ordering", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount", "pendingCount"],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["pendingCount", "newCount"],
    });

    expect(key1).toBe(key2);
  });

  it("ignores filter ordering across different fields", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [
        { field: "status", operator: "equals", value: 1 },
        { field: "department", operator: "equals", value: "Sales" },
      ],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [
        { field: "department", operator: "equals", value: "Sales" },
        { field: "status", operator: "equals", value: 1 },
      ],
    });

    expect(key1).toBe(key2);
  });

  it("ignores filter ordering for the same field+operator with different values", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [
        { field: "status", operator: "equals", value: 1 },
        { field: "status", operator: "equals", value: 2 },
      ],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [
        { field: "status", operator: "equals", value: 2 },
        { field: "status", operator: "equals", value: 1 },
      ],
    });

    expect(key1).toBe(key2);
  });

  it("ignores `in`-list value ordering", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "in", value: [1, 2, 3] }],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "in", value: [3, 1, 2] }],
    });

    expect(key1).toBe(key2);
  });

  it("treats empty axes/metrics arrays as absent", () => {
    const explicit = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: [],
      metrics: ["newCount"],
    });
    const absent = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });

    expect(explicit).toBe(absent);
  });

  it("de-duplicates repeated axes and metrics", () => {
    const duped = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["department", "department"],
      metrics: ["newCount", "newCount"],
    });

    expect(duped).toBe(buildCacheKey(BASE_QUERY));
  });

  it("treats an explicitly-undefined filter value as absent", () => {
    const explicit = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "isNull", value: undefined }],
    });
    const absent = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "isNull" }],
    });

    expect(explicit).toBe(absent);
  });

  it("is insensitive to the query object's own key order", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      axes: ["department"],
      metrics: ["newCount"],
      limit: 10,
    });
    const key2 = buildCacheKey({
      limit: 10,
      metrics: ["newCount"],
      axes: ["department"],
      model: "PurchaseRequisitions",
    });

    expect(key1).toBe(key2);
  });
});

describe("buildCacheKey — semantic differences change the key", () => {
  it("different filter values", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "equals", value: 1 }],
    });
    const key2 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
      filters: [{ field: "status", operator: "equals", value: 2 }],
    });

    expect(key1).not.toBe(key2);
  });

  it("different models", () => {
    const key1 = buildCacheKey({
      model: "PurchaseRequisitions",
      metrics: ["newCount"],
    });
    const key2 = buildCacheKey({
      model: "Expenses",
      metrics: ["newCount"],
    });

    expect(key1).not.toBe(key2);
  });

  it("different axes and metrics", () => {
    expect(
      buildCacheKey({ model: "M", axes: ["a"], metrics: ["m"] }),
    ).not.toBe(buildCacheKey({ model: "M", axes: ["b"], metrics: ["m"] }));
    expect(
      buildCacheKey({ model: "M", axes: ["a"], metrics: ["m"] }),
    ).not.toBe(buildCacheKey({ model: "M", axes: ["a"], metrics: ["n"] }));
  });

  it("different operators", () => {
    const equals = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [{ field: "s", operator: "equals", value: 1 }],
    });
    const notEquals = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [{ field: "s", operator: "notEquals", value: 1 }],
    });

    expect(equals).not.toBe(notEquals);
  });

  it("different limit / offset", () => {
    const base: AxisQuery = { model: "M", metrics: ["m"] };
    expect(buildCacheKey({ ...base, limit: 10 })).not.toBe(
      buildCacheKey({ ...base, limit: 20 }),
    );
    expect(buildCacheKey({ ...base, limit: 10 })).not.toBe(
      buildCacheKey({ ...base }),
    );
    expect(buildCacheKey({ ...base, offset: 0 })).not.toBe(
      buildCacheKey({ ...base, offset: 10 }),
    );
  });

  it("orderBy priority order is significant", () => {
    const key1 = buildCacheKey({
      model: "M",
      axes: ["a", "b"],
      orderBy: [
        { field: "a", direction: "asc" },
        { field: "b", direction: "desc" },
      ],
    });
    const key2 = buildCacheKey({
      model: "M",
      axes: ["a", "b"],
      orderBy: [
        { field: "b", direction: "desc" },
        { field: "a", direction: "asc" },
      ],
    });

    expect(key1).not.toBe(key2);
  });

  it("orderBy direction is significant", () => {
    const asc = buildCacheKey({
      model: "M",
      metrics: ["m"],
      orderBy: [{ field: "m", direction: "asc" }],
    });
    const desc = buildCacheKey({
      model: "M",
      metrics: ["m"],
      orderBy: [{ field: "m", direction: "desc" }],
    });

    expect(asc).not.toBe(desc);
  });

  it("null, NaN and missing filter values never collide", () => {
    const nullKey = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [{ field: "s", operator: "equals", value: null }],
    });
    const nanKey = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [
        { field: "s", operator: "equals", value: Number.NaN as unknown as number },
      ],
    });
    const missingKey = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [{ field: "s", operator: "isNull" }],
    });

    expect(new Set([nullKey, nanKey, missingKey]).size).toBe(3);
  });

  it("+Infinity and -Infinity are distinct from each other and from null", () => {
    const pos = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [
        {
          field: "s",
          operator: "equals",
          value: Number.POSITIVE_INFINITY as unknown as number,
        },
      ],
    });
    const neg = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [
        {
          field: "s",
          operator: "equals",
          value: Number.NEGATIVE_INFINITY as unknown as number,
        },
      ],
    });
    const nullKey = buildCacheKey({
      model: "M",
      metrics: ["m"],
      filters: [{ field: "s", operator: "equals", value: null }],
    });

    expect(new Set([pos, neg, nullKey]).size).toBe(3);
  });
});

describe("buildCacheKey — invalid input fails loud", () => {
  it("rejects a missing model", () => {
    expect(() =>
      buildCacheKey({ metrics: ["m"] } as unknown as AxisQuery),
    ).toThrow(TypeError);
  });

  it("rejects an empty model", () => {
    expect(() => buildCacheKey({ model: "", metrics: ["m"] })).toThrow(
      TypeError,
    );
  });

  it("rejects a non-object query", () => {
    expect(() => buildCacheKey(null as unknown as AxisQuery)).toThrow(
      TypeError,
    );
    expect(() => buildCacheKey("M" as unknown as AxisQuery)).toThrow(
      TypeError,
    );
  });

  it("rejects an empty prefix", () => {
    expect(() => buildCacheKey(BASE_QUERY, { prefix: "" })).toThrow(
      TypeError,
    );
  });

  it("rejects unserializable values instead of silently colliding", () => {
    expect(() =>
      buildCacheKey({
        model: "M",
        metrics: ["m"],
        filters: [
          {
            field: "s",
            operator: "equals",
            value: (() => 1) as unknown as number,
          },
        ],
      }),
    ).toThrow(TypeError);
  });
});
