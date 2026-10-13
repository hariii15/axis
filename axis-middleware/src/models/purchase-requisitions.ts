import { defineModel } from "axis";

// Keep model definitions next to the app that owns them.
// `defineModel` only type-checks; call `registerModel` (see below)
// or put the model in an isolated `ModelRegistry`.
export const PurchaseRequisitions = defineModel({
  name: "PurchaseRequisitions",
  source: {
    type: "table",
    table: "upeg.requisition_deails",
  },
  axes: {
    id: { sql: "requisition_id", type: "string", primaryKey: true },
    status: { sql: "status", type: "number" },
    department: { sql: "department_name", type: "string" },
    // Exposed so row ownership travels into the search index —
    // user-level security filters (created_by) need the field present.
    createdBy: { sql: "created_by", type: "string" },
    // Exposed so numeric range filters (and future sum/avg metrics)
    // work against the search index.
    amount: { sql: "amount", type: "number" },
    createdAt: { sql: "created_date", type: "time" },
    hasAssignedBuyer: {
      // NOTE: the outer reference must be table-qualified. The inner
      // table has its own requisition_id column, so a bare
      // `requisition_id` would resolve to the inner row and the EXISTS
      // would be constant (true whenever ANY item row has a date).
      sql: `EXISTS (
        SELECT 1
        FROM upeg.requisition_item ri
        WHERE ri.requisition_id = upeg.requisition_deails.requisition_id
          AND ri.last_buyer_assignment_date IS NOT NULL
      )`,
      type: "boolean",
    },
  },
  metrics: {
    newCount: {
      type: "count",
      description: "Requisitions created in the selected period.",
    },
    pendingCount: {
      type: "count",
      sql: "requisition_id",
      filters: [{ field: "status", operator: "equals", value: 1 }],
    },
    assignedCount: {
      type: "count",
      sql: "requisition_id",
      filters: [{ field: "hasAssignedBuyer", operator: "equals", value: true }],
    },
  },
  security: {
    function: {
      name: "upeg.get_requisitions_for_user",
      args: ["userId"],
    },
  },
  // Search representation (Phase 4). Verified against the live schema:
  // the table has no business_unit/title/description columns, so
  // department_name is currently the only embeddable text.
  search: {
    index: "purchase-requisitions",
    searchable: ["department"],
    embeddingInput: ["department"],
    embeddingField: "embedding",
  },
});
