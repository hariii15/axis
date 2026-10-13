import { describe, expect, it } from "vitest";

import { AxisQueryEngine } from "../../src/core/query-engine/query-engine.js";
import { SecurityContextError } from "../../src/core/security/errors.js";
import { CacheManager } from "../../src/core/cache/cache-manager.js";
import { MemoryCache } from "../../src/core/cache/memory-cache.js";
import { ModelRegistry } from "../../src/model/registry.js";
import { defineModel } from "../../src/model/model.js";
import type { AxisSecurityConfig } from "../../src/core/security/types.js";

function createRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  registry.register(
    defineModel({
      name: "PurchaseRequisitions",
      source: { type: "table", table: "upeg.requisition_deails" },
      axes: { department: { sql: "department_name", type: "string" } },
      metrics: { newCount: { type: "count" } },
    }),
  );
  return registry;
}

const SECURITY: AxisSecurityConfig = {
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

interface RecordedCall {
  sql: string;
  params: unknown[];
}

/**
 * Minimal fake standing in for Database: records every statement,
 * simulates transaction BEGIN/COMMIT scoping, and returns tenant-aware rows.
 */
function createFakeDatabase() {
  const calls: RecordedCall[] = [];
  let session: Record<string, string> = {};
  let inTransaction = false;
  let dbCalls = 0;

  const database = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      dbCalls += 1;
      return { rows: [{ tenant: session["app.tenant_id"] ?? null }], rowCount: 1 };
    },
    async transaction<T>(fn: (client: { query: (sql: string, p?: unknown[]) => Promise<unknown> }) => Promise<T>): Promise<T> {
      calls.push({ sql: "BEGIN", params: [] });
      const prev = { ...session };
      inTransaction = true;
      const client = {
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          if (sql.startsWith("SELECT set_config")) {
            session[String(params[0])] = String(params[1]);
            return { rows: [], rowCount: 0 };
          }
          dbCalls += 1;
          return { rows: [{ tenant: session["app.tenant_id"] ?? null }], rowCount: 1 };
        },
      };
      try {
        const result = await fn(client as never);
        calls.push({ sql: "COMMIT", params: [] });
        return result as T;
      } catch (error) {
        calls.push({ sql: "ROLLBACK", params: [] });
        throw error;
      } finally {
        inTransaction = false;
        session = prev;
      }
    },
  };

  return {
    database: database as never,
    calls,
    sessionSnapshot: () => ({ ...session }),
    isInTransaction: () => inTransaction,
    dbCalls: () => dbCalls,
  };
}

const QUERY = { model: "PurchaseRequisitions", metrics: ["newCount"] };

describe("AxisQueryEngine security integration", () => {
  it("applies SET LOCAL via set_config inside a transaction (parameterized)", async () => {
    const fake = createFakeDatabase();
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      security: SECURITY,
    });

    const result = await engine.query(QUERY, {
      context: { tenant: "tenant-001", user: "a@example.com" },
    });

    expect(result.rows).toEqual([{ tenant: "tenant-001" }]);

    const sqls = fake.calls.map((c) => c.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("SELECT set_config($1, $2, true)");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");

    // Values bound as parameters, never interpolated (quote-safety).
    const setCalls = fake.calls.filter((c) => c.sql.startsWith("SELECT set_config"));
    expect(setCalls).toHaveLength(2);
    expect(setCalls[0]?.params).toEqual(["app.tenant_id", "tenant-001"]);
    expect(setCalls[1]?.params).toEqual(["app.user_id", "a@example.com"]);
  });

  it("fails closed when required context is missing (no DB call)", async () => {
    const fake = createFakeDatabase();
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      security: SECURITY,
    });

    await expect(engine.query(QUERY, { context: { user: "a@example.com" } })).rejects.toThrow(
      SecurityContextError,
    );
    expect(fake.dbCalls()).toBe(0);
  });

  it("does not leak session between pooled requests (pool isolation)", async () => {
    const fake = createFakeDatabase();
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      security: SECURITY,
    });

    const r1 = await engine.query(QUERY, {
      context: { tenant: "tenant-001", user: "a@example.com" },
    });
    const r2 = await engine.query(QUERY, {
      context: { tenant: "tenant-002", user: "b@example.com" },
    });

    expect(r1.rows).toEqual([{ tenant: "tenant-001" }]);
    expect(r2.rows).toEqual([{ tenant: "tenant-002" }]);
    // Session reset after each transaction.
    expect(fake.sessionSnapshot()).toEqual({});
  });

  it("isolates cache entries per tenant and reuses same-tenant hits", async () => {
    const fake = createFakeDatabase();
    const cache = new CacheManager({ backend: new MemoryCache() });
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      cache,
      security: SECURITY,
    });

    const t1 = { tenant: "tenant-001", user: "a@example.com" };
    const t2 = { tenant: "tenant-002", user: "b@example.com" };

    await engine.query(QUERY, { context: t1 }); // miss -> DB (1)
    expect(fake.dbCalls()).toBe(1);
    await engine.query(QUERY, { context: t1 }); // hit -> no DB
    expect(fake.dbCalls()).toBe(1);
    const r2 = await engine.query(QUERY, { context: t2 }); // miss -> DB (2)
    expect(fake.dbCalls()).toBe(2);
    expect(r2.rows).toEqual([{ tenant: "tenant-002" }]);
  });

  it("supports constructor with (database, { security }) options shape", async () => {
    const fake = createFakeDatabase();
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      security: SECURITY,
    });
    expect(engine.getSecurityConfig()).toEqual(SECURITY);
  });

  it("handles quote-containing values safely via parameters", async () => {
    const fake = createFakeDatabase();
    const engine = new AxisQueryEngine(fake.database, {
      registry: createRegistry(),
      security: SECURITY,
    });
    const evil = "t1'; DROP TABLE upeg.requisition_deails; --";
    const result = await engine.query(QUERY, {
      context: { tenant: evil, user: "a@example.com" },
    });
    expect(result.rows).toEqual([{ tenant: evil }]);
    const setCalls = fake.calls.filter((c) => c.sql.startsWith("SELECT set_config"));
    expect(setCalls[0]?.params?.[1]).toBe(evil);
    // No interpolation: raw SQL text never contains the value.
    for (const c of fake.calls) {
      expect(c.sql).not.toContain("DROP TABLE");
    }
  });
});
