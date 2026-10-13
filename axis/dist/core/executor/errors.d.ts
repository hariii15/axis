export declare class ExecutionError extends Error {
    readonly cause?: unknown;
    readonly sql?: string | undefined;
    readonly parameters?: unknown[] | undefined;
    constructor(message: string, cause?: unknown, sql?: string | undefined, parameters?: unknown[] | undefined);
}
//# sourceMappingURL=errors.d.ts.map