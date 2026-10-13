import type { FilterOperator } from "./types.js";

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

export const ORDER_DIRECTIONS = [
  "asc",
  "desc",
] as const;

export const DEFAULT_LIMIT = 100;

export const MAX_LIMIT = 10_000;