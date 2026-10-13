// Moved from axis/src/core/context/jwt.ts (legacy claim names).
// New code should use verifyJwt()/createAxisContext() from ./auth.js.
import jwt from "jsonwebtoken";
import type { RequestContext, JWTConfig } from "./context-types.js";

export function resolveJWTContext(token: string, config: JWTConfig): RequestContext {
  try {
    const payload = jwt.verify(token, config.secret);

    if (typeof payload !== "object" || payload === null) {
      throw new Error("JWT payload must be an object.");
    }

    const context: RequestContext = {};

    if (typeof payload.userId === "string") {
      context.userId = payload.userId;
    }

    if (typeof payload.role === "string") {
      context.role = payload.role;
    }

    if (typeof payload.tenantId === "string") {
      context.tenantId = payload.tenantId;
    }

    return context;
  } catch (error) {
    throw new Error(
      `Failed to resolve JWT context: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
