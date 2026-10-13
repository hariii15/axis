/**
 * Relationship registry — logical joins between models.
 *
 * Models describe logical data; relationships describe logical
 * joins; datasources describe where the physical data lives.
 * Nothing here mentions OpenSearch, S3, JSON or Parquet.
 */
export class RelationshipRegistry {
    relationships = [];
    register(relationship) {
        if (!relationship.from || !relationship.to) {
            throw new Error("Relationship must define `from` and `to` models.");
        }
        if (!relationship.fromKey || !relationship.toKey) {
            throw new Error("Relationship must define `fromKey` and `toKey`.");
        }
        const duplicate = this.relationships.some((r) => r.from === relationship.from &&
            r.to === relationship.to &&
            r.fromKey === relationship.fromKey &&
            r.toKey === relationship.toKey);
        if (duplicate) {
            throw new Error(`Relationship "${relationship.from}" -> "${relationship.to}" is already registered.`);
        }
        this.relationships.push({ ...relationship });
    }
    /** Direct edge `from` -> `to`, either direction-registered or reversed. */
    findDirect(from, to) {
        const direct = this.relationships.find((r) => r.from === from && r.to === to);
        if (direct)
            return direct;
        const reversed = this.relationships.find((r) => r.from === to && r.to === from);
        if (!reversed)
            return undefined;
        // Reverse the direction so callers always join from -> to.
        return {
            from,
            to,
            type: reversed.type === "one-to-many"
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
    findPath(from, to) {
        if (from === to)
            return [];
        const visited = new Set([from]);
        const queue = [{ node: from, path: [] }];
        while (queue.length > 0) {
            const current = queue.shift();
            for (const rel of this.relationships) {
                const neighbor = rel.from === current.node ? rel.to : rel.to === current.node ? rel.from : undefined;
                if (neighbor === undefined || visited.has(neighbor))
                    continue;
                const step = rel.from === current.node
                    ? rel
                    : {
                        from: current.node,
                        to: neighbor,
                        type: rel.type === "one-to-many"
                            ? "many-to-one"
                            : rel.type === "many-to-one"
                                ? "one-to-many"
                                : rel.type,
                        fromKey: rel.toKey,
                        toKey: rel.fromKey,
                    };
                const path = [...current.path, step];
                if (neighbor === to)
                    return path;
                visited.add(neighbor);
                queue.push({ node: neighbor, path });
            }
        }
        throw new Error(`No relationship path from "${from}" to "${to}".`);
    }
    getAll() {
        return this.relationships.map((r) => ({ ...r }));
    }
    get size() {
        return this.relationships.length;
    }
    clear() {
        this.relationships.length = 0;
    }
}
export const defaultRelationshipRegistry = new RelationshipRegistry();
//# sourceMappingURL=relationship.js.map