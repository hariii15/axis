import type { AxisContext } from "../context/types.js";
import type { AxisSecurityConfig } from "./types.js";
/**
 * Convert `AxisContext + AxisSecurityConfig` into OpenSearch term filters.
 *
 * Same mappings, same fail-closed semantics as `resolveSecurityContext`,
 * but emitted as filter clauses instead of PostgreSQL session values:
 *
 * ```ts
 * buildOpenSearchSecurityFilters(
 *   { tenant: "tenant-001", user: "a@b.com" },
 *   config,
 * );
 * // => [{ term: { tenant_id: "tenant-001" } }, { term: { created_by: "a@b.com" } }]
 * ```
 *
 * - Field is `mapping.searchField ?? mapping.column`.
 * - Missing `required: true` values throw `SecurityContextError` (fail-closed).
 * - Missing optional values are skipped.
 * - Never inspects JWT fields, never assumes keys.
 */
export declare function buildOpenSearchSecurityFilters(context: AxisContext, config: AxisSecurityConfig): Record<string, unknown>[];
//# sourceMappingURL=opensearch.d.ts.map