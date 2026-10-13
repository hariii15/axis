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

export class RelationshipRegistry {
  private readonly relationships: Relationship[] = [];

  register(relationship: Relationship): void {
    if (!relationship.from || !relationship.to) {
      throw new Error("Relationship must define `from` and `to` models.");
    }
    if (!relationship.fromKey || !relationship.toKey) {
      throw new Error("Relationship must define `fromKey` and `toKey`.");
    }
    const duplicate = this.relationships.some(
      (r) =>
        r.from === relationship.from &&
        r.to === relationship.to &&
        r.fromKey === relationship.fromKey &&
        r.toKey === relationship.toKey,
    );
    if (duplicate) {
      throw new Error(
        `Relationship "${relationship.from}" -> "${relationship.to}" is already registered.`,
      );
    }
    this.relationships.push({ ...relationship });
  }

  /** Direct edge `from` -> `to`, either direction-registered or reversed. */
  findDirect(from: string, to: string): Relationship | undefined {
    const direct = this.relationships.find((r) => r.from === from && r.to === to);
    if (direct) return direct;
    const reversed = this.relationships.find((r) => r.from === to && r.to === from);
    if (!reversed) return undefined;
    // Reverse the direction so callers always join from -> to.
    return {
      from,
      to,
      type:
        reversed.type === "one-to-many"
          ? "many-to-one"
          : reversed.type === "many-to-one"
            ? "one-to-many"
            : reversed.type,
      fromKey: reversed.toKey,
      toKey: reversed.fromKey,
    };
  }

  /**
   * Join path from `from` to `to` (BFS, shortest first).
   * Returns an empty array when `from === to`.
   * Throws when no path exists.
   */
  findPath(from: string, to: string): Relationship[] {
    if (from === to) return [];
    const visited = new Set<string>([from]);
    const queue: Array<{ node: string; path: Relationship[] }> = [{ node: from, path: [] }];
    while (queue.length > 0) {
      const current = queue.shift() as { node: string; path: Relationship[] };
      for (const rel of this.relationships) {
        const neighbor =
          rel.from === current.node ? rel.to : rel.to === current.node ? rel.from : undefined;
        if (neighbor === undefined || visited.has(neighbor)) continue;
        const step: Relationship =
          rel.from === current.node
            ? rel
            : {
                from: current.node,
                to: neighbor,
                type:
                  rel.type === "one-to-many"
                    ? "many-to-one"
                    : rel.type === "many-to-one"
                      ? "one-to-many"
                      : rel.type,
                fromKey: rel.toKey,
                toKey: rel.fromKey,
              };
        const path = [...current.path, step];
        if (neighbor === to) return path;
        visited.add(neighbor);
        queue.push({ node: neighbor, path });
      }
    }
    throw new Error(`No relationship path from "${from}" to "${to}".`);
  }

  getAll(): Relationship[] {
    return this.relationships.map((r) => ({ ...r }));
  }

  get size(): number {
    return this.relationships.length;
  }

  clear(): void {
    this.relationships.length = 0;
  }
}

export const defaultRelationshipRegistry = new RelationshipRegistry();
