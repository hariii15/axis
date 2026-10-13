/**
 * Generic Axis execution context (Phase 8).
 *
 * Axis is application-agnostic: it never knows JWT structure, claim
 * names, tenant IDs, user IDs, or column names. The middleware /
 * application owns authentication and converts the authenticated
 * identity into this generic record.
 *
 * Example:
 *
 * ```ts
 * const context: AxisContext = {
 *   tenant: "tenant-001",
 *   user: "hariharpradeep@gmail.com",
 *   roles: ["MANAGER"],
 * };
 * ```
 */
export type AxisContext = Record<string, unknown>;
//# sourceMappingURL=types.d.ts.map