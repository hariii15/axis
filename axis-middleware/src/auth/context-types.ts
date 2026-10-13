// Moved from axis/src/core/context/type.ts (legacy JWT-shaped context).
// New code should use the generic AxisContext from "axis" instead.

export interface RequestContext {
  userId?: string;
  role?: string;
  tenantId?: string;
}

export interface JWTConfig {
  secret: string;
}
