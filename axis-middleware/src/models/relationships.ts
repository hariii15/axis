import { RelationshipRegistry } from "axis";

// Architecture A2 join topology (middleware-owned).
//
// CompanyInfo 1:N ContactInfo (via ContactInfo.companyId → CompanyInfo.id)
// CompanyInfo 1:N FinancialInfo (via FinancialInfo.companyId → CompanyInfo.id)
//
// The library only sees the generic `RelationshipRegistry` — model names
// and keys here are case-specific to this middleware.
export function createA2Relationships(): RelationshipRegistry {
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
  return relationships;
}
