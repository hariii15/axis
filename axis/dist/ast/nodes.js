/**
 * Creates an Axis AST node.
 */
export function createAxisNode(name) {
    return {
        type: "axis",
        name,
    };
}
/**
 * Creates a Metric AST node.
 */
export function createMetricNode(name) {
    return {
        type: "metric",
        name,
    };
}
/**
 * Creates a Filter AST node.
 */
export function createFilterNode(field, operator, value) {
    return {
        type: "filter",
        field,
        operator,
        ...(value !== undefined ? { value } : {}),
    };
}
/**
 * Creates a Search AST node.
 */
export function createSearchNode(searchType, text, fields, k) {
    return {
        type: "search",
        searchType,
        text,
        ...(fields !== undefined ? { fields } : {}),
        ...(k !== undefined ? { k } : {}),
    };
}
/**
 * Creates an OrderBy AST node.
 */
export function createOrderByNode(field, direction) {
    return {
        type: "orderBy",
        field,
        direction,
    };
}
//# sourceMappingURL=nodes.js.map