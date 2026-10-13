import { defineModel } from "axis";

// Architecture A2 — normalized ContactInfo model (OpenSearch-backed).
// `companyId` is the FK → CompanyInfo.id (1:N).
export const ContactInfo = defineModel({
  name: "ContactInfo",
  dataset: "contactinfo",
  source: {
    type: "table",
    table: "contact_details",
  },
  axes: {
    // One row per company in the current seed (company_id is unique);
    // it doubles as the FK → CompanyInfo.id and the document id.
    companyId: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    contactName: { sql: "contact_name", type: "string" },
    contactNumber: { sql: "contact_number", type: "string" },
    email: { sql: "email_id", type: "string" },
  },
  metrics: {
    totalContacts: {
      type: "count",
      description: "Total contacts.",
    },
  },
  security: {
    openSearch: { shared: true },
  },
  search: {
    index: "contactinfo",
    searchable: ["contactName"],
    embeddingInput: ["contactName"],
    embeddingField: "embedding",
  },
});
