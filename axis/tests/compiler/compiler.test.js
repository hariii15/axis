import { describe, expect, it } from "vitest";
import { parseAxisQuery } from "../../src/core/query/validator.js";
import { buildQueryAST } from "../../src/ast/builder.js";
import { defineModel } from "../../src/model/model.js";
import { resolveQuery } from "../../src/core/resolver/resolver.js";
import { compileQuery } from "../../src/core/compiler/compiler.js";
const PurchaseRequisitions = defineModel({
    name: "PurchaseRequisitions",
    source: {
        type: "table",
        table: "upeg.requisition_deails",
    },
    axes: {
        department: {
            sql: "department_name",
            type: "string",
        },
        status: {
            sql: "status",
            type: "number",
        },
    },
    metrics: {
        newCount: {
            type: "count",
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
        amountTotal: {
            type: "sum",
            sql: "amount",
        },
    },
});
function compile(input) {
    const query = parseAxisQuery(input);
    const ast = buildQueryAST(query);
    const resolved = resolveQuery(ast, PurchaseRequisitions);
    return compileQuery(resolved);
}
describe("SQL Compiler", () => {
    it("compiles a metric-only query", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
        });
        expect(result.sql).toBe('SELECT COUNT(*) AS "newCount" FROM upeg.requisition_deails LIMIT ?');
        expect(result.parameters).toEqual([
            {
                name: "param0",
                value: 100,
            },
        ]);
    });
    it("compiles axes and metrics", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            axes: ["department"],
            metrics: ["newCount"],
        });
        expect(result.sql).toBe('SELECT department_name AS "department", COUNT(*) AS "newCount" FROM upeg.requisition_deails GROUP BY department_name LIMIT ?');
    });
    it("compiles multiple axes", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            axes: [
                "department",
                "status",
            ],
            metrics: ["newCount"],
        });
        expect(result.sql).toBe('SELECT department_name AS "department", status AS "status", COUNT(*) AS "newCount" FROM upeg.requisition_deails GROUP BY department_name, status LIMIT ?');
    });
    it("compiles a metric with an aggregate expression", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["amountTotal"],
        });
        expect(result.sql).toContain('SUM(amount) AS "amountTotal"');
    });
    it("compiles a query filter", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                {
                    field: "status",
                    operator: "equals",
                    value: 1,
                },
            ],
        });
        expect(result.sql).toContain("WHERE status = ?");
        expect(result.parameters).toContainEqual({
            name: "param0",
            value: 1,
        });
    });
    it("compiles a metric filter", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["pendingCount"],
        });
        expect(result.sql).toContain("WHERE status = ?");
        expect(result.parameters).toContainEqual({
            name: "param0",
            value: 1,
        });
    });
    it("compiles an IN filter", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                {
                    field: "department",
                    operator: "in",
                    value: [
                        "Chemical",
                        "TBWES",
                    ],
                },
            ],
        });
        expect(result.sql).toContain("department_name IN (?, ?)");
        expect(result.parameters).toEqual([
            {
                name: "param0",
                value: "Chemical",
            },
            {
                name: "param1",
                value: "TBWES",
            },
            {
                name: "param2",
                value: 100,
            },
        ]);
    });
    it("compiles NULL filters", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                {
                    field: "department",
                    operator: "isNull",
                },
            ],
        });
        expect(result.sql).toContain("department_name IS NULL");
    });
    it("compiles ORDER BY", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            axes: ["department"],
            metrics: ["newCount"],
            orderBy: [
                {
                    field: "newCount",
                    direction: "desc",
                },
            ],
        });
        expect(result.sql).toContain('ORDER BY newCount DESC');
    });
    it("compiles LIMIT", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            limit: 50,
        });
        expect(result.parameters).toContainEqual({
            name: "param0",
            value: 50,
        });
    });
    it("compiles OFFSET", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            limit: 50,
            offset: 100,
        });
        expect(result.sql).toContain("LIMIT ? OFFSET ?");
        expect(result.parameters).toEqual([
            {
                name: "param0",
                value: 50,
            },
            {
                name: "param1",
                value: 100,
            },
        ]);
    });
    it("compiles a complete analytical query", () => {
        const result = compile({
            model: "PurchaseRequisitions",
            axes: [
                "department",
            ],
            metrics: [
                "newCount",
                "pendingCount",
            ],
            filters: [
                {
                    field: "department",
                    operator: "equals",
                    value: "Chemical",
                },
            ],
            orderBy: [
                {
                    field: "newCount",
                    direction: "desc",
                },
            ],
            limit: 25,
            offset: 10,
        });
        expect(result.sql).toBe('SELECT department_name AS "department", COUNT(*) AS "newCount", COUNT(requisition_id) AS "pendingCount" FROM upeg.requisition_deails WHERE department_name = ? AND status = ? GROUP BY department_name ORDER BY newCount DESC LIMIT ? OFFSET ?');
        expect(result.parameters).toEqual([
            {
                name: "param0",
                value: "Chemical",
            },
            {
                name: "param1",
                value: 1,
            },
            {
                name: "param2",
                value: 25,
            },
            {
                name: "param3",
                value: 10,
            },
        ]);
    });
});
//# sourceMappingURL=compiler.test.js.map