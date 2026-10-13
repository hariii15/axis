import type { FilterValue, FilterOperator, SearchType } from "../core/query/types.js";
import type { AxisNode, MetricNode, FilterNode, OrderByNode, SearchNode } from "./types.js";
/**
 * Creates an Axis AST node.
 */
export declare function createAxisNode(name: string): AxisNode;
/**
 * Creates a Metric AST node.
 */
export declare function createMetricNode(name: string): MetricNode;
/**
 * Creates a Filter AST node.
 */
export declare function createFilterNode(field: string, operator: FilterOperator, value?: FilterValue): FilterNode;
/**
 * Creates a Search AST node.
 */
export declare function createSearchNode(searchType: SearchType, text: string, fields?: string[], k?: number): SearchNode;
/**
 * Creates an OrderBy AST node.
 */
export declare function createOrderByNode(field: string, direction: "asc" | "desc"): OrderByNode;
//# sourceMappingURL=nodes.d.ts.map