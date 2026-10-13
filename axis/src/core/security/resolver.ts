import type { AxisContext } from "../context/types.js";
import { SecurityContextError } from "./errors.js";
import type {
  AxisSecurityConfig,
  ResolvedSecurityContext,
} from "./types.js";

/**
 * Convert `AxisContext + AxisSecurityConfig` into PostgreSQL session values.
 *
 * - Reads each configured mapping.
 * - Finds the corresponding value in the context via `mapping.contextKey`.
 * - Validates required values (fail-closed).
 * - Returns session values keyed by `mapping.sessionKey`.
 * - Never inspects JWT fields, never decodes JWTs, never assumes keys.
 */
export function resolveSecurityContext(
  context: AxisContext,
  config: AxisSecurityConfig,
): ResolvedSecurityContext {
  const values: Record<string, string> = {};
  const cacheKey: Record<string, unknown> = {};

  const mappings = config.mappings ?? {};

  for (const mapping of Object.values(mappings)) {
    validateMapping(mapping);

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

    const stringValue = toSessionString(raw, mapping.contextKey);

    validateSessionKey(mapping.sessionKey);

    values[mapping.sessionKey] = stringValue;
    cacheKey[mapping.contextKey] = raw;
  }

  return { values, cacheKey };
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function toSessionString(value: unknown, contextKey: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  throw new SecurityContextError(
    `Security context value "${contextKey}" must be a string, number, or boolean.`,
    contextKey,
  );
}

function validateMapping(mapping: {
  contextKey: string;
  column: string;
  sessionKey: string;
}): void {
  if (typeof mapping.contextKey !== "string" || mapping.contextKey.length === 0) {
    throw new SecurityContextError(
      "Security mapping requires a non-empty contextKey.",
    );
  }
  if (typeof mapping.sessionKey !== "string" || mapping.sessionKey.length === 0) {
    throw new SecurityContextError(
      `Security mapping for "${mapping.contextKey}" requires a non-empty sessionKey.`,
      mapping.contextKey,
    );
  }
  validateSessionKey(mapping.sessionKey);
}

/**
 * Session keys are interpolated as identifiers (they cannot be bound as
 * parameters in `SET LOCAL`), so they must be allow-listed to a safe
 * character set. Values are always bound via `set_config($1, $2, true)`.
 */
const SESSION_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function validateSessionKey(sessionKey: string): void {
  if (!SESSION_KEY_PATTERN.test(sessionKey)) {
    throw new SecurityContextError(
      `Invalid security sessionKey "${sessionKey}".`,
    );
  }
}
