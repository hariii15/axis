import { describe, expect, it } from "vitest";

import { MemoryCache } from "../../src/core/cache/memory-cache.js";
import { createCacheKey } from "../../src/core/cache/cache-key.js";

describe("MemoryCache", () => {
  it("returns undefined on cache miss", async () => {
    const cache = new MemoryCache();

    const result = await cache.get("missing");

    expect(result).toBeUndefined();
  });

  it("stores and retrieves a value", async () => {
    const cache = new MemoryCache();

    await cache.set("user:1", {
      name: "Hari",
    });

    const result = await cache.get<{ name: string }>("user:1");

    expect(result).toEqual({
      name: "Hari",
    });
  });

  it("overwrites an existing value", async () => {
    const cache = new MemoryCache();

    await cache.set("key", "old");
    await cache.set("key", "new");

    expect(await cache.get("key")).toBe("new");
  });

  it("expires values after TTL", async () => {
    const cache = new MemoryCache();

    await cache.set("key", "value", 20);

    expect(await cache.get("key")).toBe("value");

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(await cache.get("key")).toBeUndefined();
  });

  it("a TTL of 0 expires on the next read", async () => {
    const cache = new MemoryCache();

    await cache.set("key", "value", 0);

    expect(await cache.get("key")).toBeUndefined();
  });

  it.each([
    ["negative TTL", -1],
    ["NaN TTL", Number.NaN],
    ["Infinity TTL", Number.POSITIVE_INFINITY],
  ])("rejects %s instead of storing a dead entry", async (_label, ttl) => {
    const cache = new MemoryCache();

    await expect(cache.set("key", "value", ttl)).rejects.toThrow(RangeError);
    expect(await cache.get("key")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("rejects an invalid maxSize at construction", () => {
    expect(() => new MemoryCache({ maxSize: 0 })).toThrow(RangeError);
    expect(() => new MemoryCache({ maxSize: -5 })).toThrow(RangeError);
    expect(() => new MemoryCache({ maxSize: 1.5 })).toThrow(RangeError);
  });

  it("evicts the oldest entry when maxSize is exceeded", async () => {
    const cache = new MemoryCache({ maxSize: 2 });

    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);

    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("an overwrite refreshes recency (overwritten key survives eviction)", async () => {
    const cache = new MemoryCache({ maxSize: 2 });

    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("a", 10); // refresh "a"
    await cache.set("c", 3); // must evict "b", not "a"

    expect(await cache.get("a")).toBe(10);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBe(3);
  });

  it("prefers dropping expired entries over live ones on overflow", async () => {
    const cache = new MemoryCache({ maxSize: 2 });

    await cache.set("dead", "x", 0); // already expired
    await cache.set("live", "y");
    await cache.set("new", "z");

    expect(await cache.get("live")).toBe("y");
    expect(await cache.get("new")).toBe("z");
    expect(cache.size).toBe(2);
  });

  it("deletes a value", async () => {
    const cache = new MemoryCache();

    await cache.set("key", "value");
    await cache.delete("key");

    expect(await cache.get("key")).toBeUndefined();
  });

  it("clears the cache", async () => {
    const cache = new MemoryCache();

    await cache.set("one", 1);
    await cache.set("two", 2);

    await cache.clear();

    expect(await cache.get("one")).toBeUndefined();
    expect(await cache.get("two")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("createCacheKey", () => {
  it("is stable regardless of object key order", () => {
    const a = createCacheKey({
      model: "M",
      axes: ["d"],
      metrics: ["c"],
      limit: 10,
      offset: 0,
    });
    const b = createCacheKey({
      offset: 0,
      limit: 10,
      metrics: ["c"],
      axes: ["d"],
      model: "M",
    });

    expect(a).toBe(b);
    expect(a.startsWith("axis:")).toBe(true);
  });

  it("preserves array order (filter order is significant)", () => {
    const a = createCacheKey({
      model: "M",
      metrics: ["c"],
      filters: [
        { field: "s", operator: "equals", value: 1 },
        { field: "d", operator: "equals", value: "x" },
      ],
    });
    const b = createCacheKey({
      model: "M",
      metrics: ["c"],
      filters: [
        { field: "d", operator: "equals", value: "x" },
        { field: "s", operator: "equals", value: 1 },
      ],
    });

    expect(a).not.toBe(b);
  });

  it("never collides null with NaN / Infinity", () => {
    const nullKey = createCacheKey({
      model: "M",
      metrics: ["c"],
      filters: [{ field: "s", operator: "equals", value: null }],
    });
    // Bypass the FilterValue type to prove keygen is collision-free even
    // for values the validator would reject.
    const nanKey = createCacheKey({
      model: "M",
      metrics: ["c"],
      filters: [{ field: "s", operator: "equals", value: Number.NaN as never }],
    });
    const infKey = createCacheKey({
      model: "M",
      metrics: ["c"],
      filters: [
        { field: "s", operator: "equals", value: Number.POSITIVE_INFINITY as never },
      ],
    });

    expect(new Set([nullKey, nanKey, infKey]).size).toBe(3);
  });

  it("distinguishes different models, axes and metrics", () => {
    const base = { model: "M", axes: ["d"], metrics: ["c"] };
    const otherModel = { ...base, model: "Other" };
    const otherAxis = { ...base, axes: ["other"] };
    const otherMetric = { ...base, metrics: ["other"] };

    expect(new Set([createCacheKey(base), createCacheKey(otherModel)]).size).toBe(2);
    expect(
      new Set([createCacheKey(base), createCacheKey(otherAxis)]).size,
    ).toBe(2);
    expect(
      new Set([createCacheKey(base), createCacheKey(otherMetric)]).size,
    ).toBe(2);
  });
});
