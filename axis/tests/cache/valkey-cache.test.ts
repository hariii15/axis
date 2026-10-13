import { describe, expect, it } from "vitest";

import { ValkeyCache } from "../../src/core/cache/valkey-cache.js";
import type { ValkeyClient } from "../../src/core/cache/valkey-cache.js";

/** In-memory Valkey stand-in honoring MATCH/COUNT pagination. */
class FakeValkey implements ValkeyClient {
  readonly store = new Map<string, { raw: string; pxAt?: number }>();
  readonly setCalls: { key: string; args: (string | number)[] }[] = [];
  quitCalls = 0;
  /**
   * Snapshot at cursor "0", like a real opaque SCAN cursor: keys
   * deleted mid-iteration must not shift the remaining pages.
   */
  private scanSnapshot: string[] | null = null;

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.pxAt !== undefined && Date.now() >= entry.pxAt) {
      this.store.delete(key);
      return null;
    }
    return entry.raw;
  }

  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown> {
    this.setCalls.push({ key, args });
    let pxAt: number | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "PX" && typeof args[i + 1] === "number") {
        pxAt = Date.now() + (args[i + 1] as number);
      }
    }
    this.store.set(key, pxAt === undefined ? { raw: value } : { raw: value, pxAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async unlink(...keys: string[]): Promise<number> {
    return this.del(...keys);
  }

  async scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[string, string[]]> {
    let match = "*";
    let count = 10;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "MATCH") {
        match = String(args[i + 1]);
      }
      if (args[i] === "COUNT") {
        count = Number(args[i + 1]);
      }
    }
    const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
    if (String(cursor) === "0" || this.scanSnapshot === null) {
      this.scanSnapshot = [...this.store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort();
    }
    const start = String(cursor) === "0" ? 0 : Number(cursor);
    const matching = this.scanSnapshot;
    const page = matching.slice(start, start + count);
    const next = start + count >= matching.length ? "0" : String(start + count);
    if (next === "0") {
      this.scanSnapshot = null;
    }
    return [next, page];
  }

  async quit(): Promise<unknown> {
    this.quitCalls += 1;
    return "OK";
  }
}

describe("ValkeyCache", () => {
  it("round-trips objects (JSON serialization)", async () => {
    const cache = new ValkeyCache({ client: new FakeValkey() });
    const value = { rows: [{ c: 1 }], rowCount: 1 };

    expect(await cache.get("k")).toBeUndefined();
    await cache.set("k", value);
    expect(await cache.get("k")).toEqual(value);
  });

  it("stores TTL in milliseconds via PX (no seconds rounding)", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await cache.set("k", 1, 60_000);

    expect(client.setCalls).toEqual([{ key: "k", args: ["PX", 60_000] }]);
    expect(await cache.get("k")).toBe(1);
  });

  it("writes without expiry when no TTL is given", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await cache.set("k", 1);

    expect(client.setCalls).toEqual([{ key: "k", args: [] }]);
  });

  it("skips the write for ttl 0 (Valkey rejects PX 0)", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await cache.set("k", 1, 0);

    expect(client.setCalls).toEqual([]);
    expect(client.store.size).toBe(0);
  });

  it("rejects invalid TTLs without writing", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await expect(cache.set("k", 1, -5)).rejects.toThrow(RangeError);
    await expect(cache.set("k", 1, Number.NaN)).rejects.toThrow(RangeError);
    expect(client.store.size).toBe(0);
  });

  it("treats corrupt entries as a miss and reaps them", async () => {
    const client = new FakeValkey();
    client.store.set("k", { raw: "{not-json" });
    const cache = new ValkeyCache({ client });

    expect(await cache.get("k")).toBeUndefined();
    expect(client.store.has("k")).toBe(false);
  });

  it("deletes a single key", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await cache.set("k", 1);
    await cache.delete("k");

    expect(await cache.get("k")).toBeUndefined();
  });

  it("clear() removes only namespaced keys, page by page", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client, scanCount: 2 });

    await cache.set("axis:A:1", 1);
    await cache.set("axis:A:2", 2);
    await cache.set("axis:B:3", 3);
    client.store.set("sessions:xyz", { raw: "{}" }); // foreign data

    await cache.clear();

    expect(client.store.has("axis:A:1")).toBe(false);
    expect(client.store.has("axis:A:2")).toBe(false);
    expect(client.store.has("axis:B:3")).toBe(false);
    expect(client.store.has("sessions:xyz")).toBe(true); // never touched
  });

  it("honors a custom clear pattern", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client, clearMatch: "axis:v2:*" });

    await cache.set("axis:v2:A:1", 1);
    await cache.set("axis:A:2", 2);

    await cache.clear();

    expect(client.store.has("axis:v2:A:1")).toBe(false);
    expect(client.store.has("axis:A:2")).toBe(true);
  });

  it("describe() reports unknown rather than scanning", async () => {
    const cache = new ValkeyCache({ client: new FakeValkey() });

    expect(await cache.describe()).toEqual({});
  });

  it("close() never quits an injected client", async () => {
    const client = new FakeValkey();
    const cache = new ValkeyCache({ client });

    await cache.close();

    expect(client.quitCalls).toBe(0);
  });
});
