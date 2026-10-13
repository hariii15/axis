export function createCacheKey(query) {
    return `axis:${stableStringify(query)}`;
}
/**
 * Deterministic serialization for cache keys: object keys are sorted so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` map to the same key, while array
 * order is preserved (filter order is semantically significant).
 *
 * Unlike `JSON.stringify`, every distinct value maps to a distinct token:
 * `NaN`/`Infinity` stringify to `"null"` under `JSON.stringify`, which
 * would collide with a real `null` — here they get their own tokens.
 */
function stableStringify(value) {
    if (value === undefined) {
        return "undefined";
    }
    if (typeof value === "number") {
        if (Number.isNaN(value)) {
            return "NaN";
        }
        if (value === Number.POSITIVE_INFINITY) {
            return "Infinity";
        }
        if (value === Number.NEGATIVE_INFINITY) {
            return "-Infinity";
        }
        return JSON.stringify(value);
    }
    if (value === null || typeof value !== "object") {
        // string | boolean — JSON.stringify always returns a string here.
        // The `??` guards non-serializable values (function/symbol), which
        // cannot appear in a validated query but must never crash keygen.
        return JSON.stringify(value) ?? "undefined";
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const object = value;
    const keys = Object.keys(object).sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
        .join(",")}}`;
}
//# sourceMappingURL=cache-key.js.map