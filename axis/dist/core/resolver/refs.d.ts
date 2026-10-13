/**
 * Dotted field references: "ContactInfo.email" vs bare "email".
 *
 * Bare names resolve against the root model. Dotted names name the
 * owning model explicitly and are resolved via the ModelRegistry.
 */
export interface FieldRef {
    /** Owning model name, or undefined for bare refs (root model). */
    model: string | undefined;
    field: string;
}
/**
 * Parse a query field reference. "ContactInfo.email" ->
 * { model: "ContactInfo", field: "email" }; "email" ->
 * { model: undefined, field: "email" }.
 */
export declare function parseFieldRef(value: string): FieldRef;
/** Canonical display name: bare for root-model fields, dotted otherwise. */
export declare function displayRef(rootModel: string, model: string, field: string): string;
//# sourceMappingURL=refs.d.ts.map