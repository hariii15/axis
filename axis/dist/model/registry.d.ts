import type { ModelDefinition } from "./types.js";
export declare class ModelRegistry {
    private readonly models;
    register(model: ModelDefinition): void;
    get(name: string): ModelDefinition;
    has(name: string): boolean;
    remove(name: string): boolean;
    clear(): void;
    get size(): number;
    getAll(): ModelDefinition[];
}
export declare const defaultModelRegistry: ModelRegistry;
export declare function registerModel(model: ModelDefinition): void;
export declare function getModel(name: string): ModelDefinition;
export declare function hasModel(name: string): boolean;
//# sourceMappingURL=registry.d.ts.map