import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import {
  AuthError,
  createAuthMiddleware,
  createAxisContext,
  extractBearerToken,
  verifyJwt,
} from "../src/auth/auth.js";

const SECRET = "test-secret-for-phase-8";

function sign(payload: Record<string, unknown>, secret = SECRET, expiresIn = "1h"): string {
  return jwt.sign(payload, secret, { expiresIn });
}

describe("JWT verification (middleware-owned)", () => {
  it("verifies a valid spec-shape JWT", () => {
    const token = sign({
      sub: "hariharpradeep@gmail.com",
      tenantId: "tenant-001",
      roles: ["MANAGER"],
    });
    const decoded = verifyJwt(token, SECRET);
    expect(decoded.sub).toBe("hariharpradeep@gmail.com");
    expect(decoded.tenantId).toBe("tenant-001");
  });

  it("verifies the legacy .env token shape (userId/role/tenantId)", () => {
    const token = sign({
      userId: "hariharpradeep@gmail.com",
      role: "MANAGER",
      tenantId: "effigo",
    });
    const context = createAxisContext(verifyJwt(token, SECRET));
    expect(context).toEqual({
      user: "hariharpradeep@gmail.com",
      tenant: "effigo",
      roles: ["MANAGER"],
    });
  });

  it("rejects an invalid signature", () => {
    const token = sign({ sub: "a@b.com", tenantId: "t1" }, "wrong-secret");
    expect(() => verifyJwt(token, SECRET)).toThrow(AuthError);
  });

  it("rejects an expired JWT", () => {
    const token = jwt.sign(
      { sub: "a@b.com", tenantId: "t1", exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
    );
    expect(() => verifyJwt(token, SECRET)).toThrow(AuthError);
  });

  it("rejects a JWT without subject/tenant claims", () => {
    const token = sign({ foo: "bar" });
    expect(() => verifyJwt(token, SECRET)).toThrow(AuthError);
  });

  it("rejects a missing Authorization header", () => {
    expect(() => extractBearerToken(undefined)).toThrow("Missing Authorization header.");
  });

  it("rejects an invalid Bearer format", () => {
    expect(() => extractBearerToken("Token abc")).toThrow("Invalid Bearer format");
    expect(() => extractBearerToken("Bearer ")).toThrow("Invalid Bearer format");
  });

  it("creates the correct AxisContext from decoded JWT", () => {
    const context = createAxisContext({
      sub: "hariharpradeep@gmail.com",
      tenantId: "tenant-001",
      roles: ["MANAGER"],
    });
    expect(context).toEqual({
      user: "hariharpradeep@gmail.com",
      tenant: "tenant-001",
      roles: ["MANAGER"],
    });
  });

  it("defaults roles to [] when absent", () => {
    const context = createAxisContext({ sub: "a@b.com", tenantId: "t1" });
    expect(context["roles"]).toEqual([]);
  });
});

describe("createAuthMiddleware", () => {
  it("attaches req.axisContext for a valid Bearer token", () => {
    const token = sign({
      sub: "hariharpradeep@gmail.com",
      tenantId: "tenant-001",
      roles: ["MANAGER"],
    });
    const middleware = createAuthMiddleware(SECRET);
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };
    let nextError: unknown = "not-called";
    middleware(req as never, {} as never, ((err?: unknown) => {
      nextError = err;
    }) as never);
    expect(nextError).toBeUndefined();
    expect(req["axisContext"]).toEqual({
      user: "hariharpradeep@gmail.com",
      tenant: "tenant-001",
      roles: ["MANAGER"],
    });
  });

  it("forwards an AuthError when the header is missing", () => {
    const middleware = createAuthMiddleware(SECRET);
    let nextError: unknown;
    middleware({ headers: {} } as never, {} as never, ((err?: unknown) => {
      nextError = err;
    }) as never);
    expect(nextError).toBeInstanceOf(AuthError);
  });
});
