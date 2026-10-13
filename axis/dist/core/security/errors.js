/**
 * Fail-closed security error (Phase 8).
 *
 * Thrown when a mapping marked `required: true` has no corresponding
 * value in the AxisContext. The query must NOT execute in this case.
 */
export class SecurityContextError extends Error {
    contextKey;
    constructor(message, contextKey, options) {
        super(message, options);
        this.name = "SecurityContextError";
        if (contextKey !== undefined) {
            this.contextKey = contextKey;
        }
    }
}
//# sourceMappingURL=errors.js.map