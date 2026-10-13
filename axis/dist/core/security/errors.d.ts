/**
 * Fail-closed security error (Phase 8).
 *
 * Thrown when a mapping marked `required: true` has no corresponding
 * value in the AxisContext. The query must NOT execute in this case.
 */
export declare class SecurityContextError extends Error {
    readonly contextKey?: string;
    constructor(message: string, contextKey?: string, options?: ErrorOptions);
}
//# sourceMappingURL=errors.d.ts.map