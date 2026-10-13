import { ExecutionTarget } from "./types.js";
import type { ExecutionPlan, PlanContext, PlanInput, PlannerConfig, PlanningRule, QueryPlanner } from "./types.js";
export interface DefaultQueryPlannerOptions {
    rules?: PlanningRule[];
    defaultTarget?: ExecutionTarget;
}
/**
 * Deterministic rule-based query planner (Phase 6).
 *
 * No LLMs, no heuristics — pure rules, fully testable:
 *
 * 1. App-provided custom rules run first (sorted by `priority` desc).
 * 2. Semantic / hybrid search → OpenSearch (+ vector search).
 * 3. Full-text search → OpenSearch.
 * 4. Everything else → `defaultTarget` (PostgreSQL unless overridden).
 *
 * S3 statistics routing is left to app-provided custom rules for now
 * (e.g. a rule matching precomputed dashboard metrics).
 */
export declare class DefaultQueryPlanner implements QueryPlanner {
    private readonly rules;
    private readonly defaultTarget;
    constructor(options?: DefaultQueryPlannerOptions);
    plan(query: PlanInput, context?: PlanContext): Promise<ExecutionPlan>;
}
export declare function createDefaultPlanner(config?: PlannerConfig): DefaultQueryPlanner;
//# sourceMappingURL=planner.d.ts.map