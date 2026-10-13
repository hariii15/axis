export interface CompiledOpenSearchQuery {
    index: string;
    body: Record<string, unknown>;
}
export interface OpenSearchDSL extends Record<string, unknown> {
    query: Record<string, unknown>;
    aggs?: Record<string, unknown>;
    sort?: Record<string, unknown>[];
    size?: number;
    from?: number;
    _source?: string[];
}
export interface OpenSearchAgg {
    name: string;
    type: string;
    field?: string;
    script?: string;
}
export interface OpenSearchMetricAgg {
    name: string;
    type: string;
    field?: string;
    script?: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map