
import { ExecutionTarget, executionTargetForDataSource } from "./types.js";
import type {
  ExecutionPlan,
  PlanContext,
  PlanInput,
  PlannerConfig,
  PlanningRule,
  QueryPlanner,
} from "./types.js";

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
export class DefaultQueryPlanner implements QueryPlanner {
  private readonly rules: PlanningRule[];
  private readonly defaultTarget: ExecutionTarget;

  constructor(options: DefaultQueryPlannerOptions = {}) {
    this.rules = [...(options.rules ?? [])].sort(
      (a, b) => b.priority - a.priority,
    );
    this.defaultTarget = options.defaultTarget ?? ExecutionTarget.POSTGRESQL;
  }

  async plan(query: PlanInput, context: PlanContext = {}): Promise<ExecutionPlan> {
    // Explicit per-request datasource selection (benchmark / middleware
    // X-Axis-Target). Takes precedence over all rules.
    if (context.datasource !== undefined) {
      return {
        target: executionTargetForDataSource(context.datasource),
        reason: `explicit datasource "${context.datasource}"`,
        ...(context.architecture !== undefined ? { architecture: context.architecture } : {}),
      };
    }

    for (const rule of this.rules) {
      let matches = false;
      try {
        matches = rule.condition(query, context);
      } catch {
        continue;
      }
      if (matches) {
        return {
          target: rule.target,
          reason: `matched planning rule "${rule.name}"`,
          ...(rule.fallback !== undefined ? { fallback: rule.fallback } : {}),
        };
      }
    }

    if (query.search !== undefined) {
      if (
        query.search.type === "semantic" ||
        query.search.type === "hybrid"
      ) {
        return {
          target: ExecutionTarget.OPENSEARCH,
          reason: "semantic search requires vector search",
          fallback: [ExecutionTarget.POSTGRESQL],
        };
      }
      if (query.search.type === "fulltext") {
        return {
          target: ExecutionTarget.OPENSEARCH,
          reason: "full-text search",
          fallback: [ExecutionTarget.POSTGRESQL],
        };
      }
    }

    if (this.defaultTarget === ExecutionTarget.POSTGRESQL) {
      return {
        target: ExecutionTarget.POSTGRESQL,
        reason: "transactional/authoritative query defaults to PostgreSQL",
        fallback: [ExecutionTarget.OPENSEARCH],
      };
    }

    return {
      target: this.defaultTarget,
      reason: `planner default target is ${this.defaultTarget}`,
    };
  }
}

export function createDefaultPlanner(
  config: PlannerConfig = {},
): DefaultQueryPlanner {
  return new DefaultQueryPlanner({
    ...(config.rules !== undefined ? { rules: config.rules } : {}),
    ...(config.defaultTarget !== undefined
      ? { defaultTarget: config.defaultTarget }
      : {}),
  });
}
