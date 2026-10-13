export declare class DatabaseError extends Error {
    readonly code?: string | undefined;
    readonly cause?: unknown;
    constructor(message: string, code?: string | undefined, cause?: unknown);
}
//# sourceMappingURL=errors.d.ts.map