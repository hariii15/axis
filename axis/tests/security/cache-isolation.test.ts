import { describe, expect, it } from "vitest";

import { buildCacheKey } from "../../src/core/cache/key-builder.js";
import { CacheManager } from "../../src/core/cache/cache-manager.js";
import type { AxisQuery } from "../../src/core/query/types.js";

const QUERY: AxisQuery = {
  model: "PurchaseRequisitions",
  metrics: ["newCount"],
};

describe("security-aware cache keys", () => {
  it("produces different keys for different tenants", () => {
    const a = buildCacheKey(QUERY, {
      security: { tenant: "tenant-001", user: "a@example.com" },
    });
    const b = buildCacheKey(QUERY, {
      security: { tenant: "tenant-002", user: "b@example.com" },
    });
    expect(a).not.toBe(b);
  });

  it("reuses the key for same query + same tenant", () => {
    const a = buildCacheKey(QUERY, { security: { tenant: "tenant-001" } });
    const b = buildCacheKey(QUERY, { security: { tenant: "tenant-001" } });
    expect(a).toBe(b);
  });

  it("is insensitive to security object key order", () => {
    const a = buildCacheKey(QUERY, {
      security: { tenant: "t1", user: "u1" },
    });
    const b = buildCacheKey(QUERY, {
      security: { user: "u1", tenant: "t1" },
    });
    expect(a).toBe(b);
  });

  it("legacy key without security is unchanged in shape", () => {
    expect(buildCacheKey(QUERY)).toMatch(/^axis:PurchaseRequisitions:[0-9a-f]{64}$/);
  });

  it("CacheManager isolates tenants end-to-end", async () => {
    const manager = new CacheManager({});
    await manager.set(QUERY, { rows: ["t1"] }, undefined, { tenant: "tenant-001" });
    // Same query, other tenant must miss.
    expect(await manager.get(QUERY, { tenant: "tenant-002" })).toBeUndefined();
    // Same tenant hits.
    expect(await manager.get(QUERY, { tenant: "tenant-001" })).toEqual({
      rows: ["t1"],
    });
  });
});
