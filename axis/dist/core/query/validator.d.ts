import type { AxisQuery, Filter, FilterOperator, FilterValue, OrderBy, SearchInput, SearchType } from "./types.js";
export declare const FILTER_OPERATORS: readonly FilterOperator[];
export declare const ORDER_DIRECTIONS: readonly OrderBy["direction"][];
export interface ValidationIssue {
    path: (string | number)[];
    message: string;
}
export type ValidationResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    issues: ValidationIssue[];
};
export declare class ValidationError extends Error {
    readonly issues: ValidationIssue[];
    constructor(issues: ValidationIssue[], message?: string);
}
export declare function isFilterOperator(value: unknown): value is FilterOperator;
export declare function isFilterValue(value: unknown): value is FilterValue;
export declare function validateFilter(value: unknown): ValidationResult<Filter>;
export declare const SEARCH_TYPES: readonly SearchType[];
export declare function validateSearch(value: unknown): ValidationResult<SearchInput>;
export declare function validateOrderBy(value: unknown): ValidationResult<OrderBy>;
export declare function validateAxisQuery(value: unknown): ValidationResult<AxisQuery>;
export declare function isSearch(value: unknown): value is SearchInput;
export declare function parseSearch(value: unknown): SearchInput;
export declare function isFilter(value: unknown): value is Filter;
export declare function isOrderBy(value: unknown): value is OrderBy;
export declare function isAxisQuery(value: unknown): value is AxisQuery;
export declare function parseFilter(value: unknown): Filter;
export declare function parseOrderBy(value: unknown): OrderBy;
export declare function parseAxisQuery(value: unknown): AxisQuery;
export declare const safeParseFilter: typeof validateFilter;
export declare const safeParseOrderBy: typeof validateOrderBy;
export declare const safeParseAxisQuery: typeof validateAxisQuery;
export declare const safeParseSearch: typeof validateSearch;
//# sourceMappingURL=validator.d.ts.map