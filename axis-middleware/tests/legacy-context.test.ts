// Moved from axis/tests/context/context.test.ts (legacy global JWT context).
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import { clearContext, getContext } from "../src/auth/context-store.js";
import { resolveContext } from "../src/auth/context-resolver.js";

const secret = "axis-local-secret";

describe("Context Resolution", () => {
  afterEach(() => {
    clearContext();
  });

  it("resolves context from JWT", () => {
    const token = jwt.sign(
      {
        userId: "hariharpradeep@gmail.com",
        role: "MANAGER",
        tenantId: "effigo",
      },
      secret,
    );

    const context = resolveContext(token, { secret });

    expect(context).toEqual({
      userId: "hariharpradeep@gmail.com",
      role: "MANAGER",
      tenantId: "effigo",
    });
  });

  it("stores the resolved context", () => {
    const token = jwt.sign(
      {
        userId: "hariharpradeep@gmail.com",
        role: "MANAGER",
        tenantId: "effigo",
      },
      secret,
    );

    resolveContext(token, { secret });

    expect(getContext()).toEqual({
      userId: "hariharpradeep@gmail.com",
      role: "MANAGER",
      tenantId: "effigo",
    });
  });

  it("rejects an invalid token", () => {
    expect(() => resolveContext("invalid-token", { secret })).toThrow(
      "Failed to resolve JWT context",
    );
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = jwt.sign(
      {
        userId: "hariharpradeep@gmail.com",
        role: "MANAGER",
      },
      "wrong-secret",
    );

    expect(() => resolveContext(token, { secret })).toThrow(
      "Failed to resolve JWT context",
    );
  });

  it("throws when context is not initialized", () => {
    expect(() => getContext()).toThrow("Request context has not been initialized.");
  });
});
