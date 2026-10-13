import type { AxisContext } from "../context/types.js";
import { SecurityContextError } from "./errors.js";
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
export function buildOpenSearchSecurityFilters(
  context: AxisContext,
  config: AxisSecurityConfig,
): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [];
  const mappings = config.mappings ?? {};

  for (const mapping of Object.values(mappings)) {
    validateSearchMapping(mapping);

    const raw: unknown = context[mapping.contextKey];

    if (isMissing(raw)) {
      if (mapping.required === true) {
        throw new SecurityContextError(
          `Required security context value "${mapping.contextKey}" is missing.`,
          mapping.contextKey,
        );
      }
      continue;
    }

    const stringValue = toFilterString(raw, mapping.contextKey);
    const field = mapping.searchField ?? mapping.column;

    filters.push({ term: { [field]: stringValue } });
  }

  return filters;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function toFilterString(value: unknown, contextKey: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  throw new SecurityContextError(
    `Security context value "${contextKey}" must be a string, number, or boolean.`,
    contextKey,
  );
}

function validateSearchMapping(mapping: {
  contextKey: string;
  column: string;
  sessionKey: string;
  searchField?: string;
}): void {
  if (
    typeof mapping.contextKey !== "string" ||
    mapping.contextKey.length === 0
  ) {
    throw new SecurityContextError(
      "Security mapping requires a non-empty contextKey.",
    );
  }
  if (typeof mapping.column !== "string" || mapping.column.length === 0) {
    throw new SecurityContextError(
      `Security mapping for "${mapping.contextKey}" requires a non-empty column.`,
    );
  }
  const field = mapping.searchField ?? mapping.column;
  if (typeof field !== "string" || field.length === 0) {
    throw new SecurityContextError(
      `Security mapping for "${mapping.contextKey}" requires a non-empty search field.`,
    );
  }
}
