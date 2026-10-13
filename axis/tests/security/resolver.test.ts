import { describe, expect, it } from "vitest";

import { resolveSecurityContext } from "../../src/core/security/resolver.js";
import { SecurityContextError } from "../../src/core/security/errors.js";
import type { AxisSecurityConfig } from "../../src/core/security/types.js";

const CONFIG: AxisSecurityConfig = {
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

describe("resolveSecurityContext", () => {
  it("resolves tenant and user session values", () => {
    const resolved = resolveSecurityContext(
      { tenant: "tenant-001", user: "hariharpradeep@gmail.com", roles: ["MANAGER"] },
      CONFIG,
    );
    expect(resolved.values).toEqual({
      "app.tenant_id": "tenant-001",
      "app.user_id": "hariharpradeep@gmail.com",
    });
    expect(resolved.cacheKey).toEqual({
      tenant: "tenant-001",
      user: "hariharpradeep@gmail.com",
    });
  });

  it("fails closed when tenant is missing", () => {
    expect(() =>
      resolveSecurityContext({ user: "hariharpradeep@gmail.com" }, CONFIG),
    ).toThrow(SecurityContextError);
    expect(() =>
      resolveSecurityContext({ user: "hariharpradeep@gmail.com" }, CONFIG),
    ).toThrow('Required security context value "tenant" is missing.');
  });

  it("fails closed when user is missing", () => {
    expect(() => resolveSecurityContext({ tenant: "tenant-001" }, CONFIG)).toThrow(
      SecurityContextError,
    );
  });

  it("allows missing values for optional mappings", () => {
    const resolved = resolveSecurityContext(
      { tenant: "tenant-001" },
      {
        mappings: {
          tenant: {
            contextKey: "tenant",
            column: "tenant_id",
            sessionKey: "app.tenant_id",
            required: true,
          },
          department: {
            contextKey: "department",
            column: "department_name",
            sessionKey: "app.department",
            required: false,
          },
        },
      },
    );
    expect(resolved.values).toEqual({ "app.tenant_id": "tenant-001" });
  });

  it("ignores unknown context values without mappings", () => {
    const resolved = resolveSecurityContext(
      {
        tenant: "tenant-001",
        user: "hariharpradeep@gmail.com",
        roles: ["MANAGER"],
        department: "Procurement",
      },
      CONFIG,
    );
    expect(resolved.values).toEqual({
      "app.tenant_id": "tenant-001",
      "app.user_id": "hariharpradeep@gmail.com",
    });
  });

  it("rejects empty-string required values (fail-closed)", () => {
    expect(() =>
      resolveSecurityContext({ tenant: "", user: "a@b.com" }, CONFIG),
    ).toThrow(SecurityContextError);
  });

  it("rejects unsafe session keys", () => {
    expect(() =>
      resolveSecurityContext(
        { tenant: "t1" },
        {
          mappings: {
            tenant: {
              contextKey: "tenant",
              column: "tenant_id",
              sessionKey: "app.tenant_id; DROP TABLE x; --",
            },
          },
        },
      ),
    ).toThrow(SecurityContextError);
  });
});
