import { defineModel } from "axis";

// Vendor companies (shared catalog).
//
// Source is the `vendor_companies` view, which LEFT JOINs company_info +
// financial_info + contact_details (verified by scripts/seed-vendors.ts).
// A view (not raw SQL) because the ModelIndexer only extracts from
// table-like sources (`SELECT * FROM <source>`).
//
  // Metric `sql` is the DB column (SQL path); `search.field` is the indexed
  // axis-name key (OpenSearch path). They differ whenever the axis name
  // differs from the column (e.g. turnover2526 vs turnover_2025_26) —
  // omitting search.field silently aggregates a nonexistent field (sum → 0).
// so engine tenant/user term filters are skipped for this model
// (`security.openSearch.shared`). Authentication is still required;
// only per-tenant scoping is lifted.
export const Companies = defineModel({
  name: "Companies",
  source: {
    type: "table",
    table: "vendor_companies",
  },
  axes: {
    // id is mapped `keyword` (not text+keyword): exact ops must use it
    // as-is. Every other string axis is text+keyword (default behavior).
    id: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    companyName: { sql: "company_name", type: "string" },
    pan: { sql: "pan", type: "string" },
    gst: { sql: "gst", type: "string" },
    cin: { sql: "cin", type: "string" },
    msme: { sql: "msme", type: "string" },
    msmeType: { sql: "msme_type", type: "string" },
    msmeClassification: { sql: "msme_classification", type: "string" },
    turnover2324: { sql: "turnover_2023_24", type: "number" },
    turnover2425: { sql: "turnover_2024_25", type: "number" },
    turnover2526: { sql: "turnover_2025_26", type: "number" },
    contactName: { sql: "contact_name", type: "string" },
    contactNumber: { sql: "contact_number", type: "string" },
    email: { sql: "email_id", type: "string" },
  },
  metrics: {
    totalCompanies: {
      type: "count",
      description: "Total vendor companies.",
    },
    msmeCount: {
      type: "count",
      filters: [{ field: "msme", operator: "equals", value: "Yes" }],
      description: "Vendors registered as MSME.",
    },
    microCount: {
      type: "count",
      filters: [{ field: "msmeClassification", operator: "equals", value: "Micro" }],
      description: "Vendors classified Micro.",
    },
    smallCount: {
      type: "count",
      filters: [{ field: "msmeClassification", operator: "equals", value: "Small" }],
      description: "Vendors classified Small.",
    },
    mediumCount: {
      type: "count",
      filters: [{ field: "msmeClassification", operator: "equals", value: "Medium" }],
      description: "Vendors classified Medium.",
    },
    turnoverTotal: {
      type: "sum",
      sql: "turnover_2025_26",
      search: { field: "turnover2526" },
      description: "Combined FY 2025-26 turnover.",
    },
    turnoverAverage: {
      type: "avg",
      sql: "turnover_2025_26",
      search: { field: "turnover2526" },
      description: "Average FY 2025-26 turnover.",
    },
    turnoverMin: {
      type: "min",
      sql: "turnover_2025_26",
      search: { field: "turnover2526" },
      description: "Smallest FY 2025-26 turnover.",
    },
    turnoverMax: {
      type: "max",
      sql: "turnover_2025_26",
      search: { field: "turnover2526" },
      description: "Largest FY 2025-26 turnover.",
    },
    turnoverPrevTotal: {
      type: "sum",
      sql: "turnover_2024_25",
      search: { field: "turnover2425" },
      description: "Combined FY 2024-25 turnover.",
    },
  },
  security: {
    openSearch: { shared: true },
  },
  search: {
    index: "companies",
    searchable: ["companyName", "contactName"],
    embeddingInput: ["companyName", "contactName"],
    embeddingField: "embedding",
  },
});
