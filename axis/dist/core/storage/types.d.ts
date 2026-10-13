export interface StorageConfig {
    enabled?: boolean;
    adapter?: StorageAdapter;
}
export interface StorageAdapter {
    name: string;
    get(key: string): Promise<StorageObject | null>;
    put(key: string, object: StorageObject): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}
export interface StorageObject {
    key: string;
    data: unknown;
    contentType?: string;
    metadata?: Record<string, string>;
    lastModified?: Date;
    size?: number;
}
export interface S3Config extends StorageConfig {
    bucket: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    prefix?: string;
}
export interface StatisticsConfig {
    enabled?: boolean;
    bucket: string;
    prefix?: string;
    ttl?: number;
}
export interface PrecomputedStatistic {
    model: string;
    metric: string;
    axes: string[];
    filters: Record<string, unknown>;
    value: number;
    computedAt: Date;
    validUntil?: Date;
}
//# sourceMappingURL=types.d.ts.map