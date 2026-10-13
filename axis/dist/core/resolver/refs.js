/**
 * Dotted field references: "ContactInfo.email" vs bare "email".
 *
 * Bare names resolve against the root model. Dotted names name the
 * owning model explicitly and are resolved via the ModelRegistry.
 */
/**
 * Parse a query field reference. "ContactInfo.email" ->
 * { model: "ContactInfo", field: "email" }; "email" ->
 * { model: undefined, field: "email" }.
 */
export function parseFieldRef(value) {
    const dot = value.indexOf(".");
    if (dot <= 0 || dot === value.length - 1) {
        return { model: undefined, field: value };
    }
    const model = value.slice(0, dot);
    const field = value.slice(dot + 1);
    // Only one level is supported; deeper dots belong to the field name
    // (future nested documents) — keep them intact.
    if (field.includes(".")) {
        return { model: undefined, field: value };
    }
    return { model, field };
}
/** Canonical display name: bare for root-model fields, dotted otherwise. */
export function displayRef(rootModel, model, field) {
    return model === rootModel ? field : `${model}.${field}`;
}
//# sourceMappingURL=refs.js.map