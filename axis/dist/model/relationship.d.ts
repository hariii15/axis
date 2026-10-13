/**
 * Relationship registry — logical joins between models.
 *
 * Models describe logical data; relationships describe logical
 * joins; datasources describe where the physical data lives.
 * Nothing here mentions OpenSearch, S3, JSON or Parquet.
 */
export type RelationshipType = "one-to-many" | "many-to-one" | "one-to-one";
export interface Relationship {
    /** Model the join starts from (e.g. "CompanyInfo"). */
    from: string;
    /** Model the join reaches (e.g. "ContactInfo"). */
    to: string;
    type: RelationshipType;
    /** Axis/field name on the `from` model (e.g. "id"). */
    fromKey: string;
    /** Axis/field name on the `to` model (e.g. "companyId"). */
    toKey: string;
}
export declare class RelationshipRegistry {
    private readonly relationships;
    register(relationship: Relationship): void;
    /** Direct edge `from` -> `to`, either direction-registered or reversed. */
    findDirect(from: string, to: string): Relationship | undefined;
    /**
     * Join path from `from` to `to` (BFS, shortest first).
     * Returns an empty array when `from === to`.
     * Throws when no path exists.
     */
    findPath(from: string, to: string): Relationship[];
    getAll(): Relationship[];
    get size(): number;
    clear(): void;
}
export declare const defaultRelationshipRegistry: RelationshipRegistry;
//# sourceMappingURL=relationship.d.ts.map