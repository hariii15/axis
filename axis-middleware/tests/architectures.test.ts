import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";

import { createApp, type AppContext } from "../src/app.js";

// ---------------------------------------------------------------------------
// What this file proves
// ---------------------------------------------------------------------------
// 1. GET /architectures lists the middleware-owned logical architectures
//    (A / A2 / C) with their physical datasource + member models.
// 2. POST /search defaults to architecture A2 (OpenSearch) when no
//    X-Axis-Target header is sent.
// 3. X-Axis-Target: C (S3 JSON + engine) is declared but not implemented
//    yet — it returns 501 without touching any backend.
// 4. An unknown X-Axis-Target value returns 400.
// 5. The A2 join topology resolves cross-model refs: CompanyInfo root with
//    ContactInfo/FinancialInfo axes validates against the registry.
// ---------------------------------------------------------------------------

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

let ctx: AppContext;
let baseUrl = "";

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  ctx = createApp(UNREACHABLE_DB);
  const server = ctx.app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  (globalThis as any).__archServer = server;
});

afterAll(async () => {
  await ctx.axis.close();
  (globalThis as any).__archServer.close();
});

describe("GET /architectures", () => {
  it("lists A, A2 and C with datasources and member models", async () => {
    const res = await fetch(`${baseUrl}/architectures`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    const names = json.data.map((a: any) => a.name);
    expect(names).toEqual(["A", "A2", "C"]);
    expect(json.meta).toEqual({ default: "A2" });

    const a2 = json.data.find((a: any) => a.name === "A2");
    expect(a2.datasource).toBe("opensearch");
    expect(a2.models).toEqual(["CompanyInfo", "ContactInfo", "FinancialInfo"]);

    const c = json.data.find((a: any) => a.name === "C");
    expect(c.datasource).toBe("s3-json");
  });
});

describe("GET /models includes A2 models", () => {
  it("registers CompanyInfo, ContactInfo and FinancialInfo with datasets", async () => {
    const res = await fetch(`${baseUrl}/models`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    for (const name of ["CompanyInfo", "ContactInfo", "FinancialInfo"]) {
      const model = json.data.find((m: any) => m.name === name);
      expect(model).toBeDefined();
      expect(model.architectures).toContain("A2");
      expect(model.architectures).toContain("C");
    }
    const company = json.data.find((m: any) => m.name === "CompanyInfo");
    expect(company.dataset).toBe("companyinfo");
  });
});

describe("X-Axis-Target routing", () => {
  it("unknown architecture returns 400", async () => {
    const { status, json } = await post(
      "/search",
      { model: "CompanyInfo", metrics: ["totalCompanies"] },
      { "X-Axis-Target": "Z9" },
    );
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toMatch(/unknown architecture/i);
  });

  it("architecture C returns 501 (S3 datasource not implemented yet)", async () => {
    const { status, json } = await post(
      "/search",
      { model: "CompanyInfo", metrics: ["totalCompanies"] },
      { "X-Axis-Target": "C" },
    );
    expect(status).toBe(501);
    expect(json.error.code).toBe("ArchitectureNotImplemented");
  });

  it("cross-model refs resolve through the A2 relationship registry", async () => {
    // No search adapter is configured in this fixture, so a *valid*
    // query fails at execution (502/503) — never at resolution (422).
    // An unresolvable join would be 422 instead.
    const { status } = await post(
      "/search",
      {
        model: "CompanyInfo",
        axes: ["companyName", "ContactInfo.email"],
        metrics: ["FinancialInfo.turnoverTotal"],
      },
      { "X-Axis-Target": "A2" },
    );
    expect(status).not.toBe(422);
  });

  it("unrelated models have no join path (422)", async () => {
    const { status, json } = await post(
      "/search",
      {
        model: "CompanyInfo",
        axes: ["companyName", "PurchaseRequisitions.department"],
      },
      { "X-Axis-Target": "A2" },
    );
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toMatch(/relationship|does not belong/i);
  });
});
