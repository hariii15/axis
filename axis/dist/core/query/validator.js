export const FILTER_OPERATORS = [
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
];
const FILTER_OPERATOR_SET = new Set(FILTER_OPERATORS);
export const ORDER_DIRECTIONS = [
    "asc",
    "desc",
];
export class ValidationError extends Error {
    issues;
    constructor(issues, message) {
        super(message ??
            (issues
                .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
                .join("; ") || "Validation failed"));
        this.name = "ValidationError";
        this.issues = issues;
    }
}
function formatPath(path) {
    if (path.length === 0)
        return "(root)";
    return path.map((segment) => String(segment)).join(".");
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null)
        return false;
    if (Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length >= 1;
}
function isValidNumber(value) {
    return typeof value === "number" && !Number.isNaN(value);
}
export function isFilterOperator(value) {
    return typeof value === "string" && FILTER_OPERATOR_SET.has(value);
}
export function isFilterValue(value) {
    if (typeof value === "string" ||
        typeof value === "boolean" ||
        value === null) {
        return true;
    }
    if (typeof value === "number") {
        return isValidNumber(value);
    }
    if (Array.isArray(value)) {
        // Empty arrays are valid (matches zod union of string[] | number[] | boolean[]).
        // Non-empty arrays must be homogeneous, matching exactly one variant.
        if (value.length === 0)
            return true;
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
function validateStringArray(value, path, issues) {
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
    return valid ? value.slice() : undefined;
}
export function validateFilter(value) {
    const issues = [];
    if (!isPlainObject(value)) {
        return {
            success: false,
            issues: [{ path: [], message: "Expected object" }],
        };
    }
    if (!isNonEmptyString(value.field)) {
        issues.push({
            path: ["field"],
            message: typeof value.field !== "string"
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
    if (Object.prototype.hasOwnProperty.call(value, "value") &&
        value.value !== undefined &&
        !isFilterValue(value.value)) {
        issues.push({ path: ["value"], message: "Invalid filter value" });
    }
    if (issues.length > 0) {
        return { success: false, issues };
    }
    const data = {
        field: value.field,
        operator: value.operator,
    };
    if (Object.prototype.hasOwnProperty.call(value, "value") &&
        value.value !== undefined) {
        data.value = value.value;
    }
    return { success: true, data };
}
export const SEARCH_TYPES = [
    "semantic",
    "fulltext",
    "hybrid",
];
const SEARCH_TYPE_SET = new Set(SEARCH_TYPES);
export function validateSearch(value) {
    const issues = [];
    if (!isPlainObject(value)) {
        return {
            success: false,
            issues: [{ path: [], message: "Expected object" }],
        };
    }
    if (typeof value.type !== "string" ||
        !SEARCH_TYPE_SET.has(value.type)) {
        issues.push({
            path: ["type"],
            message: `Expected one of: ${SEARCH_TYPES.join(", ")}`,
        });
    }
    if (!isNonEmptyString(value.text)) {
        issues.push({
            path: ["text"],
            message: typeof value.text !== "string"
                ? "Expected string"
                : "String must contain at least 1 character",
        });
    }
    let fields;
    if (value.fields !== undefined) {
        fields = validateStringArray(value.fields, ["fields"], issues);
    }
    let k;
    if (value.k !== undefined) {
        if (!isValidNumber(value.k) ||
            !Number.isInteger(value.k) ||
            value.k <= 0) {
            issues.push({
                path: ["k"],
                message: "Expected a positive integer",
            });
        }
        else {
            k = value.k;
        }
    }
    if (issues.length > 0) {
        return { success: false, issues };
    }
    const data = {
        type: value.type,
        text: value.text,
    };
    if (fields !== undefined)
        data.fields = fields;
    if (k !== undefined)
        data.k = k;
    return { success: true, data };
}
export function validateOrderBy(value) {
    const issues = [];
    if (!isPlainObject(value)) {
        return {
            success: false,
            issues: [{ path: [], message: "Expected object" }],
        };
    }
    if (!isNonEmptyString(value.field)) {
        issues.push({
            path: ["field"],
            message: typeof value.field !== "string"
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
            field: value.field,
            direction: value.direction,
        },
    };
}
export function validateAxisQuery(value) {
    const issues = [];
    if (!isPlainObject(value)) {
        return {
            success: false,
            issues: [{ path: [], message: "Expected object" }],
        };
    }
    if (!isNonEmptyString(value.model)) {
        issues.push({
            path: ["model"],
            message: typeof value.model !== "string"
                ? "Expected string"
                : "String must contain at least 1 character",
        });
    }
    let axes;
    if (value.axes !== undefined) {
        axes = validateStringArray(value.axes, ["axes"], issues);
    }
    let metrics;
    if (value.metrics !== undefined) {
        metrics = validateStringArray(value.metrics, ["metrics"], issues);
    }
    let filters;
    if (value.filters !== undefined) {
        if (!Array.isArray(value.filters)) {
            issues.push({ path: ["filters"], message: "Expected array" });
        }
        else {
            const parsed = [];
            let valid = true;
            for (let index = 0; index < value.filters.length; index++) {
                const result = validateFilter(value.filters[index]);
                if (!result.success) {
                    valid = false;
                    for (const issue of result.issues) {
                        issues.push({ path: ["filters", index, ...issue.path], message: issue.message });
                    }
                }
                else {
                    parsed.push(result.data);
                }
            }
            if (valid)
                filters = parsed;
        }
    }
    let orderBy;
    if (value.orderBy !== undefined) {
        if (!Array.isArray(value.orderBy)) {
            issues.push({ path: ["orderBy"], message: "Expected array" });
        }
        else {
            const parsed = [];
            let valid = true;
            for (let index = 0; index < value.orderBy.length; index++) {
                const result = validateOrderBy(value.orderBy[index]);
                if (!result.success) {
                    valid = false;
                    for (const issue of result.issues) {
                        issues.push({ path: ["orderBy", index, ...issue.path], message: issue.message });
                    }
                }
                else {
                    parsed.push(result.data);
                }
            }
            if (valid)
                orderBy = parsed;
        }
    }
    let limit;
    if (value.limit !== undefined) {
        if (!isValidNumber(value.limit) ||
            !Number.isInteger(value.limit) ||
            value.limit <= 0) {
            issues.push({
                path: ["limit"],
                message: "Expected a positive integer",
            });
        }
        else {
            limit = value.limit;
        }
    }
    let offset;
    if (value.offset !== undefined) {
        if (!isValidNumber(value.offset) ||
            !Number.isInteger(value.offset) ||
            value.offset < 0) {
            issues.push({
                path: ["offset"],
                message: "Expected a non-negative integer",
            });
        }
        else {
            offset = value.offset;
        }
    }
    // Per-query cache TTL (ms). Validated but never part of the cache key.
    let cacheTtl;
    if (value.cacheTtl !== undefined) {
        if (typeof value.cacheTtl !== "number" ||
            !Number.isFinite(value.cacheTtl) ||
            value.cacheTtl < 0) {
            issues.push({
                path: ["cacheTtl"],
                message: "Expected a finite number >= 0 (milliseconds)",
            });
        }
        else {
            cacheTtl = value.cacheTtl;
        }
    }
    let search;
    if (value.search !== undefined) {
        const result = validateSearch(value.search);
        if (!result.success) {
            for (const issue of result.issues) {
                issues.push({ path: ["search", ...issue.path], message: issue.message });
            }
        }
        else {
            search = result.data;
        }
    }
    // Matches the previous zod `.refine()` on the query object.
    // Search-only queries (no axes/metrics) are valid — they return documents.
    if (issues.length === 0 &&
        (axes?.length ?? 0) === 0 &&
        (metrics?.length ?? 0) === 0 &&
        search === undefined) {
        issues.push({
            path: ["axes"],
            message: "Query must contain at least one axis or metric",
        });
    }
    if (issues.length > 0) {
        return { success: false, issues };
    }
    const data = { model: value.model };
    if (axes !== undefined)
        data.axes = axes;
    if (metrics !== undefined)
        data.metrics = metrics;
    if (filters !== undefined)
        data.filters = filters;
    if (orderBy !== undefined)
        data.orderBy = orderBy;
    if (limit !== undefined)
        data.limit = limit;
    if (offset !== undefined)
        data.offset = offset;
    if (cacheTtl !== undefined)
        data.cacheTtl = cacheTtl;
    if (search !== undefined)
        data.search = search;
    return { success: true, data };
}
export function isSearch(value) {
    return validateSearch(value).success;
}
export function parseSearch(value) {
    const result = validateSearch(value);
    if (!result.success)
        throw new ValidationError(result.issues);
    return result.data;
}
export function isFilter(value) {
    return validateFilter(value).success;
}
export function isOrderBy(value) {
    return validateOrderBy(value).success;
}
export function isAxisQuery(value) {
    return validateAxisQuery(value).success;
}
export function parseFilter(value) {
    const result = validateFilter(value);
    if (!result.success)
        throw new ValidationError(result.issues);
    return result.data;
}
export function parseOrderBy(value) {
    const result = validateOrderBy(value);
    if (!result.success)
        throw new ValidationError(result.issues);
    return result.data;
}
export function parseAxisQuery(value) {
    const result = validateAxisQuery(value);
    if (!result.success)
        throw new ValidationError(result.issues);
    return result.data;
}
// Aliases using zod-familiar naming for easier migration.
export const safeParseFilter = validateFilter;
export const safeParseOrderBy = validateOrderBy;
export const safeParseAxisQuery = validateAxisQuery;
export const safeParseSearch = validateSearch;
//# sourceMappingURL=validator.js.map