import { defineModel } from "axis";

// Architecture A2 — normalized CompanyInfo model (OpenSearch-backed).
//
// Logical dataset key `companyinfo` binds the physical datasource
// (OpenSearch index for A/A2, S3 prefix for C). Same semantic model
// benchmarks across architectures.
export const CompanyInfo = defineModel({
  name: "CompanyInfo",
  dataset: "companyinfo",
  source: {
    type: "table",
    table: "company_info",
  },
  axes: {
    id: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    companyName: { sql: "company_name", type: "string" },
    pan: { sql: "pan", type: "string" },
    gst: { sql: "gst", type: "string" },
    cin: { sql: "cin", type: "string" },
    msme: { sql: "msme", type: "string" },
    msmeType: { sql: "msme_type", type: "string" },
    msmeClassification: { sql: "msme_classification", type: "string" },
  },
  metrics: {
    totalCompanies: {
      type: "count",
      description: "Total companies.",
    },
  },
  security: {
    openSearch: { shared: true },
  },
  search: {
    index: "companyinfo",
    searchable: ["companyName"],
    embeddingInput: ["companyName"],
    embeddingField: "embedding",
  },
});
