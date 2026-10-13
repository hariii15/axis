import { defineModel } from "../../../src/model/model.js";

export const PurchaseRequisitions = defineModel({
  name: "PurchaseRequisitions",

  source: {
    type: "table",
    table: "upeg.requisition_deails",
  },

  axes: {
    id: {
      sql: "requisition_id",
      type: "string",
      primaryKey: true,
    },
    

    status: {
      sql: "status",
      type: "number",
    },

    businessUnit: {
      sql: "business_unit",
      type: "string",
    },

    department: {
      sql: "department_name",
      type: "string",
    },

    createdAt: {
      sql: "created_date",
      type: "time",
    },

    hasAssignedBuyer: {
      sql: `EXISTS (
        SELECT 1
        FROM upeg.requisition_item ri
        WHERE ri.requisition_id = requisition_id
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
      filters: [
        {
          field: "status",
          operator: "equals",
          value: 1,
        },
      ],
    },

    assignedCount: {
      type: "count",
      sql: "requisition_id",
      filters: [
        {
          field: "hasAssignedBuyer",
          operator: "equals",
          value: true,
        },
      ],
    },
  },

  security: {
    function: {
      name: "upeg.get_requisitions_for_user",
      args: ["userId"],
    },
  },
});