import type { ModelDefinition } from "../../model/types.js";
import type { ModelRegistry } from "../../model/registry.js";
import type { RelationshipRegistry } from "../../model/relationship.js";
import type {
  AxisNode,
  MetricNode,
  QueryAST,
  SearchNode,
} from "../../ast/types.js";

import type {
  JoinStep,
  ResolvedAxis,
  ResolvedFilter,
  ResolvedMetric,
  ResolvedOrderBy,
  ResolvedQuery,
  ResolvedSearch,
} from "./type.js";

import { ResolutionError } from "./error.js";
import { displayRef, parseFieldRef } from "./refs.js";

export interface MultiModelResolveOptions {
  registry: ModelRegistry;
  relationships?: RelationshipRegistry;
}

/**
 * Resolve a query AST against one model (legacy) or a registry.
 *
 * - `resolveQuery(ast, model)` — single-model path. Bare names only,
 *   except `Model.field` refs that name the same model.
 * - `resolveQuery(ast, { registry, relationships? })` — multi-model
 *   path. Dotted refs (`ContactInfo.email`) resolve via the registry;
 *   join steps resolve via the relationship registry.
 */
export function resolveQuery(ast: QueryAST, model: ModelDefinition): ResolvedQuery;
export function resolveQuery(ast: QueryAST, options: MultiModelResolveOptions): ResolvedQuery;
export function resolveQuery(
  ast: QueryAST,
  modelOrOptions: ModelDefinition | MultiModelResolveOptions,
): ResolvedQuery {
  if (isMultiModelOptions(modelOrOptions)) {
    return resolveMultiModel(ast, modelOrOptions);
  }
  return resolveSingleModel(ast, modelOrOptions);
}

function isMultiModelOptions(
  value: ModelDefinition | MultiModelResolveOptions,
): value is MultiModelResolveOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "registry" in value &&
    typeof (value as MultiModelResolveOptions).registry?.get === "function"
  );
}

function resolveSingleModel(ast: QueryAST, model: ModelDefinition): ResolvedQuery {
  if (ast.model !== model.name) {
    throw new ResolutionError(
      `Query model "${ast.model}" does not match model "${model.name}".`,
    );
  }

  const tracker = new JoinTracker(model.name);
  const axes = ast.axes.map((node) => {
    const ref = parseFieldRef(node.name);
    if (ref.model !== undefined && ref.model !== model.name) {
      throw new ResolutionError(
        `Axis "${node.name}" does not belong to model "${model.name}". Use the multi-model resolve path.`,
      );
    }
    return resolveAxisNode({ ...node, name: ref.field }, model, tracker);
  });
  const metrics = ast.metrics.map((node) => {
    const ref = parseFieldRef(node.name);
    if (ref.model !== undefined && ref.model !== model.name) {
      throw new ResolutionError(
        `Metric "${node.name}" does not belong to model "${model.name}". Use the multi-model resolve path.`,
      );
    }
    return resolveMetricNode({ ...node, name: ref.field }, model, tracker);
  });
  const filters: ResolvedFilter[] = ast.filters.map((node) => resolveFilterNode(node, model));
  const orderBy = ast.orderBy.map((node) => resolveOrderByNode(node, model));
  const search = ast.search !== undefined ? resolveSearchNode(ast.search, model) : undefined;

  return {
    model,
    rootModel: model,
    joinedModels: [],
    joins: [],
    axes,
    metrics,
    filters,
    orderBy,
    ...(search !== undefined ? { search } : {}),
    limit: ast.limit,
    offset: ast.offset,
  };
}

function resolveMultiModel(ast: QueryAST, options: MultiModelResolveOptions): ResolvedQuery {
  const { registry, relationships } = options;
  const root = registry.get(ast.model);
  const tracker = new JoinTracker(root.name);
  const modelsByName = new Map<string, ModelDefinition>([[root.name, root]]);

  const needModel = (name: string): ModelDefinition => {
    const existing = modelsByName.get(name);
    if (existing) return existing;
    const model = registry.get(name);
    modelsByName.set(name, model);
    tracker.requireJoin(root.name, name, relationships);
    return model;
  };

  const axes = ast.axes.map((node) => {
    const ref = parseFieldRef(node.name);
    const model = ref.model === undefined ? root : needModel(ref.model);
    return resolveAxisNode({ ...node, name: ref.field }, model, tracker, root.name);
  });
  const metrics = ast.metrics.map((node) => {
    const ref = parseFieldRef(node.name);
    const model = ref.model === undefined ? root : needModel(ref.model);
    return resolveMetricNode({ ...node, name: ref.field }, model, tracker, root.name);
  });
  const filters: ResolvedFilter[] = ast.filters.map((node) => {
    const ref = parseFieldRef(node.field);
    const model = ref.model === undefined ? root : needModel(ref.model);
    return resolveFilterNode({ ...node, field: ref.field }, model, root.name);
  });
  const orderBy = ast.orderBy.map((node) => {
    const ref = parseFieldRef(node.field);
    const model = ref.model === undefined ? root : needModel(ref.model);
    return resolveOrderByNode({ ...node, field: ref.field }, model, root.name);
  });
  const search =
    ast.search !== undefined ? resolveSearchNode(ast.search, root, needModel) : undefined;

  const joinedModels = [...modelsByName.values()].filter((m) => m.name !== root.name);

  return {
    model: root,
    rootModel: root,
    joinedModels,
    joins: tracker.joins(),
    axes,
    metrics,
    filters,
    orderBy,
    ...(search !== undefined ? { search } : {}),
    limit: ast.limit,
    offset: ast.offset,
  };
}

/** Collects join steps; validates reachability when a registry is present. */
class JoinTracker {
  private readonly steps = new Map<string, JoinStep>();

  constructor(private readonly root: string) {}

  touch(_model: string): void {
    // Bare/root refs need no join.
  }

  requireJoin(root: string, model: string, relationships: RelationshipRegistry | undefined): void {
    if (model === root) return;
    if (relationships === undefined) {
      throw new ResolutionError(
        `Query references model "${model}" but no relationship registry was provided.`,
      );
    }
    let path;
    try {
      path = relationships.findPath(root, model);
    } catch {
      throw new ResolutionError(
        `No relationship path from "${root}" to "${model}". Register a relationship joining these models.`,
      );
    }
    for (const step of path) {
      const key = `${step.from}\u0000${step.to}\u0000${step.fromKey}\u0000${step.toKey}`;
      if (!this.steps.has(key)) {
        this.steps.set(key, { ...step });
      }
    }
  }

  joins(): JoinStep[] {
    return [...this.steps.values()];
  }
}

function resolveSearchNode(
  node: SearchNode,
  root: ModelDefinition,
  needModel?: (name: string) => ModelDefinition,
): ResolvedSearch {
  if (node.fields !== undefined) {
    for (const field of node.fields) {
      const ref = parseFieldRef(field);
      const model =
        ref.model === undefined || ref.model === root.name ? root : needModel?.(ref.model);
      if (model === undefined) {
        throw new ResolutionError(
          `Search field "${field}" references unknown model "${ref.model}".`,
        );
      }
      if (model.axes[ref.field] === undefined) {
        throw new ResolutionError(
          `Search field "${ref.field}" does not exist as an axis in model "${model.name}".`,
        );
      }
    }
  }
  return { node };
}

function resolveAxisNode(
  node: AxisNode,
  model: ModelDefinition,
  tracker: JoinTracker,
  rootName?: string,
): ResolvedAxis {
  const definition = model.axes[node.name];
  if (!definition) {
    throw new ResolutionError(
      `Axis "${node.name}" does not exist in model "${model.name}".`,
    );
  }
  tracker.touch(model.name);
  const root = rootName ?? model.name;
  return {
    name: displayRef(root, model.name, node.name),
    model: model.name,
    field: node.name,
    definition,
    node,
  };
}

function resolveMetricNode(
  node: MetricNode,
  model: ModelDefinition,
  tracker: JoinTracker,
  rootName?: string,
): ResolvedMetric {
  const definition = model.metrics[node.name];
  if (!definition) {
    throw new ResolutionError(
      `Metric "${node.name}" does not exist in model "${model.name}".`,
    );
  }
  tracker.touch(model.name);
  const root = rootName ?? model.name;
  return {
    name: displayRef(root, model.name, node.name),
    model: model.name,
    field: node.name,
    definition,
    node,
  };
}

function resolveFilterNode(
  node: QueryAST["filters"][number],
  model: ModelDefinition,
  rootName?: string,
): ResolvedFilter {
  const ref = parseFieldRef(node.field);
  // Single-model path: dotted refs must name the same model.
  if (rootName === undefined && ref.model !== undefined && ref.model !== model.name) {
    throw new ResolutionError(
      `Filter field "${node.field}" does not belong to model "${model.name}". Use the multi-model resolve path.`,
    );
  }
  const field = ref.model === undefined ? node.field : ref.field;
  if (model.axes[field] === undefined) {
    throw new ResolutionError(
      `Filter field "${field}" does not exist as an axis in model "${model.name}".`,
    );
  }
  return { node, model: model.name, field };
}

function resolveOrderByNode(
  node: QueryAST["orderBy"][number],
  model: ModelDefinition,
  rootName?: string,
): ResolvedOrderBy {
  const ref = parseFieldRef(node.field);
  if (rootName === undefined && ref.model !== undefined && ref.model !== model.name) {
    throw new ResolutionError(
      `Order field "${node.field}" does not belong to model "${model.name}". Use the multi-model resolve path.`,
    );
  }
  const field = ref.model === undefined ? node.field : ref.field;
  const axis = model.axes[field];
  if (axis) {
    return {
      node,
      field: {
        name: displayRef(rootName ?? model.name, model.name, field),
        model: model.name,
        field,
        definition: axis,
        node: { type: "axis", name: field },
      },
    };
  }
  const metric = model.metrics[field];
  if (metric) {
    return {
      node,
      field: {
        name: displayRef(rootName ?? model.name, model.name, field),
        model: model.name,
        field,
        definition: metric,
        node: { type: "metric", name: field },
      },
    };
  }
  throw new ResolutionError(
    `Order field "${field}" does not exist as an axis or metric in model "${model.name}".`,
  );
}
