import type { AxisDefinition, MetricDefinition, ModelDefinition } from "../../model/types.js";
import type { AxisNode, FilterNode, MetricNode, OrderByNode, SearchNode } from "../../ast/types.js";
export interface ResolvedAxis {
    /** Display name: bare for root-model fields, "Model.field" otherwise. */
    name: string;
    /** Owning model name. */
    model: string;
    /** Bare field name within the owning model. */
    field: string;
    definition: AxisDefinition;
    node: AxisNode;
}
export interface ResolvedMetric {
    /** Display name: bare for root-model metrics, "Model.metric" otherwise. */
    name: string;
    /** Owning model name. */
    model: string;
    /** Bare metric name within the owning model. */
    field: string;
    definition: MetricDefinition;
    node: MetricNode;
}
export interface ResolvedFilter {
    node: FilterNode;
    /** Owning model of the filter field (root model for bare refs). */
    model: string;
    /** Bare field name within the owning model. */
    field: string;
}
/** One logical join step in a multi-model execution plan. */
export interface JoinStep {
    from: string;
    to: string;
    fromKey: string;
    toKey: string;
    type: string;
}
export interface ResolvedOrderBy {
    node: OrderByNode;
    field: ResolvedAxis | ResolvedMetric;
}
export interface ResolvedSearch {
    node: SearchNode;
}
export interface ResolvedQuery {
    model: ModelDefinition;
    /**
     * Root model (equals `model` — kept separately for clarity in
     * multi-model plans).
     */
    rootModel: ModelDefinition;
    /** Owning models beyond the root, in first-seen order. */
    joinedModels: ModelDefinition[];
    /** Logical join steps from the root to every joined model. */
    joins: JoinStep[];
    axes: ResolvedAxis[];
    metrics: ResolvedMetric[];
    filters: ResolvedFilter[];
    orderBy: ResolvedOrderBy[];
    search?: ResolvedSearch;
    limit: number;
    offset: number;
}
//# sourceMappingURL=type.d.ts.map