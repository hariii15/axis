import type { ModelDefinition } from "./types.js";

export class ModelRegistry {
  private readonly models = new Map<string, ModelDefinition>();

  register(model: ModelDefinition): void {
    if (this.models.has(model.name)) {
      throw new Error(
        `Model "${model.name}" is already registered.`,
      );
    }

    this.models.set(model.name, model);
  }

  get(name: string): ModelDefinition {
    const model = this.models.get(name);

    if (!model) {
      throw new Error(
        `Model "${name}" is not registered.`,
      );
    }

    return model;
  }

  has(name: string): boolean {
    return this.models.has(name);
  }

  remove(name: string): boolean {
    return this.models.delete(name);
  }

  clear(): void {
    this.models.clear();
  }

  get size(): number {
    return this.models.size;
  }

  getAll(): ModelDefinition[] {
    return [...this.models.values()];
  }
}

export const defaultModelRegistry = new ModelRegistry();

export function registerModel(model: ModelDefinition): void {
  defaultModelRegistry.register(model);
}

export function getModel(name: string): ModelDefinition {
  return defaultModelRegistry.get(name);
}

export function hasModel(name: string): boolean {
  return defaultModelRegistry.has(name);
}