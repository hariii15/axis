/**
 * Application-provided security mappings (Phase 8).
 *
 * Axis never hard-codes tenant IDs, user IDs, column names, or session
 * keys. The application registers these mappings once; the security
 * resolver converts a generic AxisContext into PostgreSQL session
 * values on every query.
 */
export interface SecurityMapping {
  /** Key inside AxisContext, e.g. "tenant". */
  contextKey: string;
  /** Application DB column, e.g. "tenant_id" (informational for RLS docs). */
  column: string;
  /** PostgreSQL session key, e.g. "app.tenant_id". */
  sessionKey: string;
  /** When true, a missing context value fails closed. @default false */
  required?: boolean;
  /**
   * OpenSearch field name for security filters (Phase 5).
   * Defaults to `column` when omitted.
   */
  searchField?: string;
}

export interface AxisSecurityConfig {
  mappings: Record<string, SecurityMapping>;
}

/** Session values resolved for PostgreSQL (`sessionKey -> string value`). */
export interface ResolvedSecurityContext {
  /** Values to apply via `SET LOCAL` / `set_config()`. */
  values: Record<string, string>;
  /**
   * Canonical subset of the context used for security-aware cache keys.
   * Only contains values for configured mappings (`contextKey -> value`).
   */
  cacheKey: Record<string, unknown>;
}
