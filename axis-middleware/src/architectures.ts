import type { ArchitectureName, DataSourceName } from "axis";

export type { ArchitectureName };

// Logical architectures (middleware-owned — never hardcoded in the library).
//
//   A  = legacy single-model OpenSearch (Companies / PurchaseRequisitions)
//   A2 = multi-model OpenSearch (CompanyInfo + ContactInfo + FinancialInfo)
//   C  = S3 JSON source data + Axis query execution (stubbed: 501 until the
//        S3 datasource lands; same semantic models, different physics)
export const ARCHITECTURE_A = "A";
export const ARCHITECTURE_A2 = "A2";
export const ARCHITECTURE_C = "C";

export const ARCHITECTURES: readonly ArchitectureName[] = [
  ARCHITECTURE_A,
  ARCHITECTURE_A2,
  ARCHITECTURE_C,
] as const;

export const DEFAULT_ARCHITECTURE: ArchitectureName = ARCHITECTURE_A2;

/** Architecture → physical datasource. A/A2 share OpenSearch for now. */
export const ARCHITECTURE_DATASOURCE: Record<string, DataSourceName> = {
  [ARCHITECTURE_A]: "opensearch",
  [ARCHITECTURE_A2]: "opensearch",
  [ARCHITECTURE_C]: "s3-json",
};

/** Models served by each architecture (for /architectures + validation). */
export const ARCHITECTURE_MODELS: Record<string, readonly string[]> = {
  [ARCHITECTURE_A]: ["Companies", "PurchaseRequisitions"],
  [ARCHITECTURE_A2]: ["CompanyInfo", "ContactInfo", "FinancialInfo"],
  [ARCHITECTURE_C]: ["CompanyInfo", "ContactInfo", "FinancialInfo"],
};

export function parseArchitectureHeader(raw: unknown): ArchitectureName {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return DEFAULT_ARCHITECTURE;
  if ((ARCHITECTURES as readonly string[]).includes(value)) return value;
  throw new Error(
    `Unknown architecture "${value}". Expected one of: ${ARCHITECTURES.join(", ")}.`,
  );
}

export function datasourceForArchitecture(
  architecture: ArchitectureName,
): DataSourceName {
  const datasource = ARCHITECTURE_DATASOURCE[architecture];
  if (datasource === undefined) {
    throw new Error(`No datasource mapped for architecture "${architecture}".`);
  }
  return datasource;
}
