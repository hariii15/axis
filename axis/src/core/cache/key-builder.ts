import { createHash } from "node:crypto";

import type { AxisQuery, FilterValue } from "../query/types.js";

export interface CacheKeyOptions {
  prefix?: string;
  algorithm?: string;//sha256
  /**
   * Security subset for security-aware cache keys (Phase 8).
   *
   * Must be the canonical `cacheKey` from `resolveSecurityContext`
   * (only values for configured mappings). Different security values
   * produce different digests; absent/empty security preserves the
   * legacy key so non-security queries are unaffected.
   */
  security?: Record<string, unknown>;
}

const DEFAULT_PREFIX = "axis";
const DEFAULT_ALGORITHM = "sha256";

const UNSAFE_SEGMENT_CHARS = /[^A-Za-z0-9_.-]+/g;



export function buildCacheKey(
  query: AxisQuery,
  options: CacheKeyOptions = {},
): string {
  if (typeof query !== "object" || query === null) {
    throw new TypeError(
      `buildCacheKey requires an AxisQuery object, got: ${typeName(query)}`,
    );
  }
  if (typeof query.model !== "string" || query.model.length === 0) {
    throw new TypeError(
      "buildCacheKey requires query.model to be a non-empty string",
    );
  }

  const prefix = options.prefix ?? DEFAULT_PREFIX;
  if (prefix.length === 0) {
    throw new TypeError("buildCacheKey requires a non-empty prefix");
  }
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;

  const normalized = normalizeQuery(query);
  const security = normalizeSecurity(options.security);

  const payload =
    security === undefined
      ? stableStringify(normalized)
      : stableStringify({ query: normalized, security });

  const digest = createHash(algorithm).update(payload, "utf8").digest("hex");

  return `${prefix}:${sanitizeSegment(query.model)}:${digest}`;
}

interface CanonicalQuery {
  model: string;
  axes?: string[];
  metrics?: string[];
  filters?: CanonicalFilter[];
  orderBy?: CanonicalOrderBy[];
  search?: CanonicalSearch;
  limit?: number;
  offset?: number;
}

interface CanonicalSearch {
  type: string;
  text: string;
  fields?: string[];
  k?: number;
}

interface CanonicalFilter {
  field: string;
  operator: string;
  value?: FilterValue;
}

interface CanonicalOrderBy {
  field: string;
  direction: "asc" | "desc";
}

function normalizeQuery(query: AxisQuery): CanonicalQuery {
  const normalized: CanonicalQuery = { model: query.model };

  const axes = dedupeAndSort(query.axes);
  if (axes.length > 0) {
    normalized.axes = axes;
  }

  const metrics = dedupeAndSort(query.metrics);
  if (metrics.length > 0) {
    normalized.metrics = metrics;
  }

  if (query.filters !== undefined && query.filters.length > 0) {
    normalized.filters = query.filters
      .map((filter): CanonicalFilter => {
        const canonical: CanonicalFilter = {
          field: filter.field,
          operator: filter.operator,
        };
        if (filter.value !== undefined) {
          return { ...canonical, value: normalizeValue(filter.value) };
        }
        return canonical;
      })
      // Sort by full canonical form: comparing only `field:operator`
      // would leave same-field filters in input order (AND is
      // commutative, so input order must not leak into the key).
      .sort((a, b) =>
        compareStrings(stableStringify(a), stableStringify(b)),
      );
  }

  // orderBy is intentionally NOT sorted: priority order is significant.
  if (query.orderBy !== undefined && query.orderBy.length > 0) {
    normalized.orderBy = query.orderBy.map((entry) => ({
      field: entry.field,
      direction: entry.direction,
    }));
  }

  // Search text is identity: different text must never share an entry.
  // Omitted entirely when absent so legacy keys are unchanged.
  if (query.search !== undefined) {
    const canonical: CanonicalSearch = {
      type: query.search.type,
      text: query.search.text,
    };
    if (query.search.fields !== undefined) {
      canonical.fields = [...query.search.fields].sort(compareStrings);
    }
    if (query.search.k !== undefined) {
      canonical.k = query.search.k;
    }
    normalized.search = canonical;
  }

  if (query.limit !== undefined) {
    normalized.limit = query.limit;
  }
  if (query.offset !== undefined) {
    normalized.offset = query.offset;
  }

  return normalized;
}

/** Sort scalar `in` / `notIn` lists so value order never leaks into the key. */
function normalizeValue(value: FilterValue): FilterValue {
  if (!Array.isArray(value)) {
    return value;
  }
  return [...value].sort((a, b) =>
    compareStrings(stableStringify(a), stableStringify(b)),
  ) as FilterValue;
}

/**
 * Canonicalize the security subset for hashing. Returns `undefined`
 * when there is no security to bind, preserving legacy keys.
 * Sorting is handled by `stableStringify`; values must be JSON-like
 * scalars (string/number/boolean/null/arrays thereof).
 */
function normalizeSecurity(
  security: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (security === undefined) {
    return undefined;
  }
  const keys = Object.keys(security);
  if (keys.length === 0) {
    return undefined;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const value = security[key];
    if (value === undefined) {
      continue;
    }
    normalized[key] = value;
  }
  if (Object.keys(normalized).length === 0) {
    return undefined;
  }
  return normalized;
}

function dedupeAndSort(names: readonly string[] | undefined): string[] {
  if (names === undefined) {
    return [];
  }
  return [...new Set(names)].sort(compareStrings);
}

/**
 * Locale-independent string comparison (code-unit order).
 * `String.prototype.localeCompare` varies by ICU data / runtime locale,
 * which would make the same query hash differently on different hosts.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Strip characters that are awkward in Valkey key segments. */
function sanitizeSegment(segment: string): string {
  return segment.replace(UNSAFE_SEGMENT_CHARS, "_");
}

function typeName(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

/**
 * Deterministic serialization: object keys sorted, array order
 * preserved, and every distinct value maps to a distinct token
 * (`NaN` / `±Infinity` get their own tokens instead of colliding
 * with `null` as they do under `JSON.stringify`).
 */
function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "NaN";
    }
    if (value === Number.POSITIVE_INFINITY) {
      return "Infinity";
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return "-Infinity";
    }
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    return `bigint:${value.toString()}`;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareStrings)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(object[key])}`,
      )
      .join(",")}}`;
  }

  throw new TypeError(
    `buildCacheKey cannot serialize a value of type ${typeof value}; refusing to guess a cache key`,
  );
}
