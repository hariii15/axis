import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { AxisContext } from "axis";

/**
 * Middleware-side JWT handling (moved out of the `axis` library).
 *
 * Ownership rule: the `axis` library never sees JWTs. This package owns
 * authentication: verify signature -> validate expiration -> decode
 * claims -> createAxisContext() -> axis.query(query, { context }).
 *
 * Two claim shapes are accepted (both map to the same AxisContext):
 *   spec shape:   { sub, tenantId, roles? }
 *   legacy shape: { userId, tenantId, role? }  (see .env AXIS_JWT_TOKEN)
 */

export interface DecodedJwt {
  sub?: string;
  userId?: string;
  tenantId?: string;
  tenant?: string;
  roles?: string[];
  role?: string;
  [claim: string]: unknown;
}

export class AuthError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 401, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

/** Verify a JWT with the application's secret/private key. */
export function verifyJwt(token: string, secret: string): DecodedJwt {
  if (typeof token !== "string" || token.length === 0) {
    throw new AuthError("Missing JWT.");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new AuthError("JWT secret is not configured.", 500);
  }
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload !== "object" || payload === null) {
      throw new AuthError("Invalid JWT payload.");
    }
    const claims = payload as Record<string, unknown>;
    const subject = claims["sub"] ?? claims["userId"];
    const tenant = claims["tenantId"] ?? claims["tenant"];
    if (typeof subject !== "string" || typeof tenant !== "string") {
      throw new AuthError("JWT must contain a subject (sub/userId) and a tenantId claim.");
    }
    return claims as unknown as DecodedJwt;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
      401,
      { cause: error },
    );
  }
}

/** Translate JWT claims into a generic AxisContext for the library. */
export function createAxisContext(decoded: DecodedJwt): AxisContext {
  const user = decoded.sub ?? decoded.userId;
  const tenant = decoded.tenantId ?? decoded.tenant;
  if (typeof user !== "string" || typeof tenant !== "string") {
    throw new AuthError("JWT must contain a subject (sub/userId) and a tenantId claim.");
  }
  const roles =
    decoded.roles ?? (typeof decoded.role === "string" ? [decoded.role] : []);
  return { user, tenant, roles };
}

/** Express request carrying the resolved AxisContext (set by requireAuth). */
export interface AuthenticatedRequest extends Request {
  axisContext?: AxisContext;
}

/** Extract `Bearer <token>` from an Authorization header value. */
export function extractBearerToken(header: string | string[] | undefined): string {
  if (header === undefined || header === null) {
    throw new AuthError("Missing Authorization header.");
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError("Missing Authorization header.");
  }
  const match = value.match(/^Bearer (.+)$/);
  if (match === null || match[1] === undefined || match[1].length === 0) {
    throw new AuthError("Invalid Bearer format. Expected: Bearer <JWT>.");
  }
  return match[1];
}

/**
 * Express middleware factory. Verifies the JWT, builds the AxisContext,
 * and attaches it as `req.axisContext`. Auth failures are passed to
 * `next(err)` so the central error handler maps them to 401.
 */
export function createAuthMiddleware(secret: string) {
  return function authMiddleware(
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void {
    try {
      const header = req.headers["authorization"];
      const token = extractBearerToken(
        Array.isArray(header) ? header[0] : header,
      );
      req.axisContext = createAxisContext(verifyJwt(token, secret));
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Route guard for protected endpoints. Requires `requireAuth` (or any
 * middleware that sets `req.axisContext`) to have run first.
 */
export function requireAxisContext(req: AuthenticatedRequest): AxisContext {
  if (req.axisContext === undefined) {
    throw new AuthError("Missing security context. Authentication is required.", 401);
  }
  return req.axisContext;
}
