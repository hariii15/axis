import { defineModel } from "axis";

// Architecture A2 — normalized FinancialInfo model (OpenSearch-backed).
// `companyId` is the FK → CompanyInfo.id (1:N).
export const FinancialInfo = defineModel({
  name: "FinancialInfo",
  dataset: "financialinfo",
  source: {
    type: "table",
    table: "financial_info",
  },
  axes: {
    // One row per company in the current seed (company_id is unique);
    // it doubles as the FK → CompanyInfo.id and the document id.
    companyId: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    turnover2324: { sql: "turnover_2023_24", type: "number" },
    turnover2425: { sql: "turnover_2024_25", type: "number" },
    turnover2526: { sql: "turnover_2025_26", type: "number" },
  },
  metrics: {
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
  },
  security: {
    openSearch: { shared: true },
  },
  search: {
    index: "financialinfo",
    searchable: [],
    embeddingInput: [],
    embeddingField: "embedding",
  },
});
