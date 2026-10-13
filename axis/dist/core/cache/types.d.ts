export interface CacheInfo {
    size?: number;
    evictions?: number;
}
export interface Cache {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    describe?(): CacheInfo | Promise<CacheInfo>;
    close?(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map