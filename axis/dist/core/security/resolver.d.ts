import type { AxisContext } from "../context/types.js";
import type { AxisSecurityConfig, ResolvedSecurityContext } from "./types.js";
/**
 * Convert `AxisContext + AxisSecurityConfig` into PostgreSQL session values.
 *
 * - Reads each configured mapping.
 * - Finds the corresponding value in the context via `mapping.contextKey`.
 * - Validates required values (fail-closed).
 * - Returns session values keyed by `mapping.sessionKey`.
 * - Never inspects JWT fields, never decodes JWTs, never assumes keys.
 */
export declare function resolveSecurityContext(context: AxisContext, config: AxisSecurityConfig): ResolvedSecurityContext;
//# sourceMappingURL=resolver.d.ts.map