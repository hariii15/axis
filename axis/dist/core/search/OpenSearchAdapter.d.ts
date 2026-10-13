import type { SearchAdapter, SearchParams, SearchResult, SearchIndexResult, IndexParams, OpenSearchConfig } from "./types.js";
export declare class OpenSearchAdapter implements SearchAdapter {
    readonly name = "opensearch";
    private readonly client;
    private readonly ownsClient;
    private readonly indexPrefix;
    constructor(config: OpenSearchConfig);
    private getFullIndexName;
    search(params: SearchParams): Promise<SearchResult>;
    index(params: IndexParams): Promise<SearchIndexResult>;
    deleteIndex(index: string): Promise<void>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
    private convertQuery;
    private convertSearchResponse;
}
export declare function createOpenSearchAdapter(config: OpenSearchConfig): OpenSearchAdapter;
//# sourceMappingURL=OpenSearchAdapter.d.ts.map