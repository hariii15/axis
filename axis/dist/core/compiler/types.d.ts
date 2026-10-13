export interface SQLParameter {
    name: string;
    value: unknown;
}
export interface CompiledQuery {
    sql: string;
    parameters: SQLParameter[];
}
//# sourceMappingURL=types.d.ts.map