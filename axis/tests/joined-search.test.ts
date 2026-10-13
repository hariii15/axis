import { describe, expect, it } from "vitest";

import { Axis } from "../src/core/axis.js";
import { defineModel } from "../src/model/model.js";
import { ModelRegistry } from "../src/model/registry.js";
import { RelationshipRegistry } from "../src/model/relationship.js";
import { compileToOpenSearch } from "../src/core/compiler/opensearch/index.js";
import { parseAxisQuery } from "../src/core/query/validator.js";
import { buildQueryAST } from "../src/ast/builder.js";
import { resolveQuery } from "../src/core/resolver/resolver.js";
import type {
  SearchAdapter,
  SearchParams,
  SearchResult,
} from "../src/core/search/types.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

const CompanyInfo = defineModel({
  name: "CompanyInfo",
  dataset: "companyinfo",
  source: { type: "table", table: "company_info" },
  axes: {
    id: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    companyName: { sql: "company_name", type: "string" },
    msme: { sql: "msme", type: "string" },
  },
  metrics: {
    totalCompanies: { type: "count" },
    msmeCount: {
      type: "count",
      filters: [{ field: "msme", operator: "equals", value: "Yes" }],
    },
  },
  search: { index: "companyinfo", searchable: ["companyName"] },
});

const ContactInfo = defineModel({
  name: "ContactInfo",
  dataset: "contactinfo",
  source: { type: "table", table: "contact_details" },
  axes: {
    companyId: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    contactName: { sql: "contact_name", type: "string" },
    email: { sql: "email_id", type: "string" },
  },
  metrics: {
    totalContacts: { type: "count" },
  },
  search: { index: "contactinfo", searchable: ["contactName"] },
});

const FinancialInfo = defineModel({
  name: "FinancialInfo",
  dataset: "financialinfo",
  source: { type: "table", table: "financial_info" },
  axes: {
    companyId: { sql: "company_id", type: "string", primaryKey: true, search: { exact: true } },
    turnover2526: { sql: "turnover_2025_26", type: "number" },
  },
  metrics: {
    turnoverTotal: { type: "sum", sql: "turnover_2025_26", search: { field: "turnover2526" } },
    turnoverAverage: { type: "avg", sql: "turnover_2025_26", search: { field: "turnover2526" } },
  },
  search: { index: "financialinfo" },
});

const DOCS: Record<string, Array<Record<string, unknown>>> = {
  companyinfo: [
    { id: "VEN1", companyName: "Acme", msme: "Yes" },
    { id: "VEN2", companyName: "Beta", msme: "No" },
    { id: "VEN3", companyName: "Gamma", msme: "Yes" },
  ],
  contactinfo: [
    { companyId: "VEN1", contactName: "Ann", email: "ann@acme.example" },
    { companyId: "VEN3", contactName: "Gus", email: "gus@gamma.example" },
  ],
  financialinfo: [
    { companyId: "VEN1", turnover2526: 100 },
    { companyId: "VEN2", turnover2526: 200 },
    { companyId: "VEN3", turnover2526: 300 },
  ],
};

function makeAdapter(seen: SearchParams[] = []): SearchAdapter {
  return {
    name: "fake",
    search: async (params: SearchParams): Promise<SearchResult> => {
      seen.push(params);
      const docs = DOCS[params.index] ?? [];
      const size = params.size ?? 10;
      const from = params.from ?? 0;
      const hits = docs.slice(from, from + size).map((source, i) => ({
        _index: params.index,
        _id: String(source.id ?? source.companyId ?? i),
        _score: 1,
        _source: source,
      }));
      return {
        hits,
        total: { value: docs.length, relation: "eq" },
        took: 1,
        timedOut: false,
      };
    },
    index: async () => ({ _index: "", _id: "", _version: 1, result: "created" }),
    deleteIndex: async () => undefined,
    healthCheck: async () => true,
    close: async () => undefined,
  };
}

function makeAxis(seen: SearchParams[] = []): Axis {
  const registry = new ModelRegistry();
  registry.register(CompanyInfo);
  registry.register(ContactInfo);
  registry.register(FinancialInfo);
  const relationships = new RelationshipRegistry();
  relationships.register({
    from: "CompanyInfo",
    to: "ContactInfo",
    type: "one-to-many",
    fromKey: "id",
    toKey: "companyId",
  });
  relationships.register({
    from: "CompanyInfo",
    to: "FinancialInfo",
    type: "one-to-many",
    fromKey: "id",
    toKey: "companyId",
  });
  return new Axis({
    database: { url: UNREACHABLE_DB },
    registry,
    relationships,
    searchAdapter: makeAdapter(seen),
  });
}

describe("joined OpenSearch execution", () => {
  it("projects joined axes under dotted display names (LEFT JOIN keeps unmatched roots)", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["companyName", "ContactInfo.email"],
        limit: 10,
      });
      expect(result.rowCount).toBe(3);
      expect(result.rows).toEqual([
        expect.objectContaining({ companyName: "Acme", "ContactInfo.email": "ann@acme.example" }),
        expect.objectContaining({ companyName: "Beta", "ContactInfo.email": undefined }),
        expect.objectContaining({ companyName: "Gamma", "ContactInfo.email": "gus@gamma.example" }),
      ]);
    } finally {
      await axis.close();
    }
  });

  it("filters on joined-model fields narrow the join", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["companyName", "ContactInfo.email"],
        filters: [{ field: "ContactInfo.email", operator: "contains", value: "gamma" }],
      });
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]).toMatchObject({ companyName: "Gamma" });
    } finally {
      await axis.close();
    }
  });

  it("computes metrics over joined models (ungrouped)", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        metrics: ["FinancialInfo.turnoverTotal", "FinancialInfo.turnoverAverage"],
      });
      expect(result.rows).toEqual([
        { "FinancialInfo.turnoverTotal": 600, "FinancialInfo.turnoverAverage": 200 },
      ]);
    } finally {
      await axis.close();
    }
  });

  it("groups by root axes with joined metrics per group", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["msme"],
        metrics: ["FinancialInfo.turnoverTotal"],
      });
      expect(result.rows).toEqual([
        { msme: "Yes", "FinancialInfo.turnoverTotal": 400 },
        { msme: "No", "FinancialInfo.turnoverTotal": 200 },
      ]);
    } finally {
      await axis.close();
    }
  });

  it("honors canned metric filters in joined queries", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["ContactInfo.email"],
        metrics: ["msmeCount"],
      });
      // LEFT JOIN keeps Beta (no contact); only msme=Yes rows count.
      expect(result.rows).toEqual([
        { "ContactInfo.email": "ann@acme.example", msmeCount: 1 },
        { "ContactInfo.email": undefined, msmeCount: 0 },
        { "ContactInfo.email": "gus@gamma.example", msmeCount: 1 },
      ]);
    } finally {
      await axis.close();
    }
  });

  it("paginates joined rows and reports pre-pagination rowCount", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["companyName", "ContactInfo.email"],
        limit: 2,
        offset: 1,
      });
      expect(result.rowCount).toBe(3);
      expect(result.rows.map((r) => (r as Record<string, unknown>).companyName)).toEqual([
        "Beta",
        "Gamma",
      ]);
    } finally {
      await axis.close();
    }
  });

  it("sorts by joined fields", async () => {
    const axis = makeAxis();
    try {
      const result = await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["companyName", "FinancialInfo.turnover2526"],
        orderBy: [{ field: "FinancialInfo.turnover2526", direction: "desc" }],
      });
      expect(
        result.rows.map((r) => (r as Record<string, unknown>)["FinancialInfo.turnover2526"]),
      ).toEqual([300, 200, 100]);
    } finally {
      await axis.close();
    }
  });

  it("fetches every involved model index", async () => {
    const seen: SearchParams[] = [];
    const axis = makeAxis(seen);
    try {
      await axis.searchDocuments({
        model: "CompanyInfo",
        axes: ["companyName", "ContactInfo.email"],
        metrics: ["FinancialInfo.turnoverTotal"],
      });
      expect(seen.map((p) => p.index).sort()).toEqual([
        "companyinfo",
        "contactinfo",
        "financialinfo",
      ]);
    } finally {
      await axis.close();
    }
  });

  it("single-index compilation rejects joined queries instead of miscompiling", () => {
    const registry = new ModelRegistry();
    registry.register(CompanyInfo);
    registry.register(ContactInfo);
    const relationships = new RelationshipRegistry();
    relationships.register({
      from: "CompanyInfo",
      to: "ContactInfo",
      type: "one-to-many",
      fromKey: "id",
      toKey: "companyId",
    });
    const query = parseAxisQuery({
      model: "CompanyInfo",
      axes: ["companyName", "ContactInfo.email"],
    });
    const resolved = resolveQuery(buildQueryAST(query), { registry, relationships });
    expect(() => compileToOpenSearch(resolved)).toThrow(/spans 2 models/);
  });
});
