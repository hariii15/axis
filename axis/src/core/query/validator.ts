import type {
  AxisQuery,
  Filter,
  FilterOperator,
  FilterValue,
  OrderBy,
  SearchInput,
  SearchType,
} from "./types.js";

export const FILTER_OPERATORS: readonly FilterOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "in",
  "notIn",
  "contains",
  "startsWith",
  "endsWith",
  "isNull",
  "isNotNull",
] as const;

const FILTER_OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS);

export const ORDER_DIRECTIONS: readonly OrderBy["direction"][] = [
  "asc",
  "desc",
] as const;

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export class ValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], message?: string) {
    super(
      message ??
        (issues
          .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
          .join("; ") || "Validation failed"),
    );
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === "string" && FILTER_OPERATOR_SET.has(value);
}

export function isFilterValue(value: unknown): value is FilterValue {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return true;
  }
  if (typeof value === "number") {
    return isValidNumber(value);
  }
  if (Array.isArray(value)) {
    // Empty arrays are valid (matches zod union of string[] | number[] | boolean[]).
    // Non-empty arrays must be homogeneous, matching exactly one variant.
    if (value.length === 0) return true;
    const first = value[0];
    if (typeof first === "string") {
      return value.every((item) => typeof item === "string");
    }
    if (typeof first === "number") {
      return value.every((item) => isValidNumber(item));
    }
    if (typeof first === "boolean") {
      return value.every((item) => typeof item === "boolean");
    }
    return false;
  }
  return false;
}

function validateStringArray(
  value: unknown,
  path: (string | number)[],
  issues: ValidationIssue[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected array" });
    return undefined;
  }
  let valid = true;
  for (let index = 0; index < value.length; index++) {
    if (!isNonEmptyString(value[index])) {
      issues.push({
        path: [...path, index],
        message: "Expected non-empty string",
      });
      valid = false;
    }
  }
  return valid ? (value as string[]).slice() : undefined;
}

export function validateFilter(value: unknown): ValidationResult<Filter> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      success: false,
      issues: [{ path: [], message: "Expected object" }],
    };
  }

  if (!isNonEmptyString(value.field)) {
    issues.push({
      path: ["field"],
      message:
        typeof value.field !== "string"
          ? "Expected string"
          : "String must contain at least 1 character",
    });
  }

  if (!isFilterOperator(value.operator)) {
    issues.push({
      path: ["operator"],
      message: `Expected one of: ${FILTER_OPERATORS.join(", ")}`,
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "value") &&
    value.value !== undefined &&
    !isFilterValue(value.value)
  ) {
    issues.push({ path: ["value"], message: "Invalid filter value" });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  const data: Filter = {
    field: value.field as string,
    operator: value.operator as FilterOperator,
  };
  if (
    Object.prototype.hasOwnProperty.call(value, "value") &&
    value.value !== undefined
  ) {
    data.value = value.value as FilterValue;
  }
  return { success: true, data };
}

export const SEARCH_TYPES: readonly SearchType[] = [
  "semantic",
  "fulltext",
  "hybrid",
] as const;

const SEARCH_TYPE_SET: ReadonlySet<string> = new Set(SEARCH_TYPES);

export function validateSearch(value: unknown): ValidationResult<SearchInput> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      success: false,
      issues: [{ path: [], message: "Expected object" }],
    };
  }

  if (
    typeof value.type !== "string" ||
    !SEARCH_TYPE_SET.has(value.type)
  ) {
    issues.push({
      path: ["type"],
      message: `Expected one of: ${SEARCH_TYPES.join(", ")}`,
    });
  }

  if (!isNonEmptyString(value.text)) {
    issues.push({
      path: ["text"],
      message:
        typeof value.text !== "string"
          ? "Expected string"
          : "String must contain at least 1 character",
    });
  }

  let fields: string[] | undefined;
  if (value.fields !== undefined) {
    fields = validateStringArray(value.fields, ["fields"], issues);
  }

  let k: number | undefined;
  if (value.k !== undefined) {
    if (
      !isValidNumber(value.k) ||
      !Number.isInteger(value.k) ||
      (value.k as number) <= 0
    ) {
      issues.push({
        path: ["k"],
        message: "Expected a positive integer",
      });
    } else {
      k = value.k as number;
    }
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  const data: SearchInput = {
    type: value.type as SearchType,
    text: value.text as string,
  };
  if (fields !== undefined) data.fields = fields;
  if (k !== undefined) data.k = k;
  return { success: true, data };
}

export function validateOrderBy(value: unknown): ValidationResult<OrderBy> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      success: false,
      issues: [{ path: [], message: "Expected object" }],
    };
  }

  if (!isNonEmptyString(value.field)) {
    issues.push({
      path: ["field"],
      message:
        typeof value.field !== "string"
          ? "Expected string"
          : "String must contain at least 1 character",
    });
  }

  if (value.direction !== "asc" && value.direction !== "desc") {
    issues.push({
      path: ["direction"],
      message: "Expected one of: asc, desc",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      field: value.field as string,
      direction: value.direction as OrderBy["direction"],
    },
  };
}

export function validateAxisQuery(value: unknown): ValidationResult<AxisQuery> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      success: false,
      issues: [{ path: [], message: "Expected object" }],
    };
  }

  if (!isNonEmptyString(value.model)) {
    issues.push({
      path: ["model"],
      message:
        typeof value.model !== "string"
          ? "Expected string"
          : "String must contain at least 1 character",
    });
  }

  let axes: string[] | undefined;
  if (value.axes !== undefined) {
    axes = validateStringArray(value.axes, ["axes"], issues);
  }

  let metrics: string[] | undefined;
  if (value.metrics !== undefined) {
    metrics = validateStringArray(value.metrics, ["metrics"], issues);
  }

  let filters: Filter[] | undefined;
  if (value.filters !== undefined) {
    if (!Array.isArray(value.filters)) {
      issues.push({ path: ["filters"], message: "Expected array" });
    } else {
      const parsed: Filter[] = [];
      let valid = true;
      for (let index = 0; index < value.filters.length; index++) {
        const result = validateFilter(value.filters[index]);
        if (!result.success) {
          valid = false;
          for (const issue of result.issues) {
            issues.push({ path: ["filters", index, ...issue.path], message: issue.message });
          }
        } else {
          parsed.push(result.data);
        }
      }
      if (valid) filters = parsed;
    }
  }

  let orderBy: OrderBy[] | undefined;
  if (value.orderBy !== undefined) {
    if (!Array.isArray(value.orderBy)) {
      issues.push({ path: ["orderBy"], message: "Expected array" });
    } else {
      const parsed: OrderBy[] = [];
      let valid = true;
      for (let index = 0; index < value.orderBy.length; index++) {
        const result = validateOrderBy(value.orderBy[index]);
        if (!result.success) {
          valid = false;
          for (const issue of result.issues) {
            issues.push({ path: ["orderBy", index, ...issue.path], message: issue.message });
          }
        } else {
          parsed.push(result.data);
        }
      }
      if (valid) orderBy = parsed;
    }
  }

  let limit: number | undefined;
  if (value.limit !== undefined) {
    if (
      !isValidNumber(value.limit) ||
      !Number.isInteger(value.limit) ||
      (value.limit as number) <= 0
    ) {
      issues.push({
        path: ["limit"],
        message: "Expected a positive integer",
      });
    } else {
      limit = value.limit as number;
    }
  }

  let offset: number | undefined;
  if (value.offset !== undefined) {
    if (
      !isValidNumber(value.offset) ||
      !Number.isInteger(value.offset) ||
      (value.offset as number) < 0
    ) {
      issues.push({
        path: ["offset"],
        message: "Expected a non-negative integer",
      });
    } else {
      offset = value.offset as number;
    }
  }

  // Per-query cache TTL (ms). Validated but never part of the cache key.
  let cacheTtl: number | undefined;
  if (value.cacheTtl !== undefined) {
    if (
      typeof value.cacheTtl !== "number" ||
      !Number.isFinite(value.cacheTtl) ||
      (value.cacheTtl as number) < 0
    ) {
      issues.push({
        path: ["cacheTtl"],
        message: "Expected a finite number >= 0 (milliseconds)",
      });
    } else {
      cacheTtl = value.cacheTtl as number;
    }
  }

  let search: SearchInput | undefined;
  if (value.search !== undefined) {
    const result = validateSearch(value.search);
    if (!result.success) {
      for (const issue of result.issues) {
        issues.push({ path: ["search", ...issue.path], message: issue.message });
      }
    } else {
      search = result.data;
    }
  }

  // Matches the previous zod `.refine()` on the query object.
  // Search-only queries (no axes/metrics) are valid — they return documents.
  if (
    issues.length === 0 &&
    (axes?.length ?? 0) === 0 &&
    (metrics?.length ?? 0) === 0 &&
    search === undefined
  ) {
    issues.push({
      path: ["axes"],
      message: "Query must contain at least one axis or metric",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  const data: AxisQuery = { model: value.model as string };
  if (axes !== undefined) data.axes = axes;
  if (metrics !== undefined) data.metrics = metrics;
  if (filters !== undefined) data.filters = filters;
  if (orderBy !== undefined) data.orderBy = orderBy;
  if (limit !== undefined) data.limit = limit;
  if (offset !== undefined) data.offset = offset;
  if (cacheTtl !== undefined) data.cacheTtl = cacheTtl;
  if (search !== undefined) data.search = search;
  return { success: true, data };
}

export function isSearch(value: unknown): value is SearchInput {
  return validateSearch(value).success;
}

export function parseSearch(value: unknown): SearchInput {
  const result = validateSearch(value);
  if (!result.success) throw new ValidationError(result.issues);
  return result.data;
}

export function isFilter(value: unknown): value is Filter {
  return validateFilter(value).success;
}

export function isOrderBy(value: unknown): value is OrderBy {
  return validateOrderBy(value).success;
}

export function isAxisQuery(value: unknown): value is AxisQuery {
  return validateAxisQuery(value).success;
}

export function parseFilter(value: unknown): Filter {
  const result = validateFilter(value);
  if (!result.success) throw new ValidationError(result.issues);
  return result.data;
}

export function parseOrderBy(value: unknown): OrderBy {
  const result = validateOrderBy(value);
  if (!result.success) throw new ValidationError(result.issues);
  return result.data;
}

export function parseAxisQuery(value: unknown): AxisQuery {
  const result = validateAxisQuery(value);
  if (!result.success) throw new ValidationError(result.issues);
  return result.data;
}

// Aliases using zod-familiar naming for easier migration.
export const safeParseFilter = validateFilter;
export const safeParseOrderBy = validateOrderBy;
export const safeParseAxisQuery = validateAxisQuery;
export const safeParseSearch = validateSearch;
