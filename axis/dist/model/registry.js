export class ModelRegistry {
    models = new Map();
    register(model) {
        if (this.models.has(model.name)) {
            throw new Error(`Model "${model.name}" is already registered.`);
        }
        this.models.set(model.name, model);
    }
    get(name) {
        const model = this.models.get(name);
        if (!model) {
            throw new Error(`Model "${name}" is not registered.`);
        }
        return model;
    }
    has(name) {
        return this.models.has(name);
    }
    remove(name) {
        return this.models.delete(name);
    }
    clear() {
        this.models.clear();
    }
    get size() {
        return this.models.size;
    }
    getAll() {
        return [...this.models.values()];
    }
}
export const defaultModelRegistry = new ModelRegistry();
export function registerModel(model) {
    defaultModelRegistry.register(model);
}
export function getModel(name) {
    return defaultModelRegistry.get(name);
}
export function hasModel(name) {
    return defaultModelRegistry.has(name);
}
//# sourceMappingURL=registry.js.map