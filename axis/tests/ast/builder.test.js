import { describe, expect, it } from "vitest";
import { DEFAULT_LIMIT, } from "../../src/core/query/schema.js";
import { parseAxisQuery, } from "../../src/core/query/validator.js";
import { buildQueryAST, } from "../../src/ast/builder.js";
describe("Query AST Builder", () => {
    it("builds an AST from a basic axis query", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: ["department"],
            metrics: ["newCount"],
        });
        const ast = buildQueryAST(query);
        expect(ast.model).toBe("PurchaseRequisitions");
        expect(ast.axes).toEqual([
            {
                type: "axis",
                name: "department",
            },
        ]);
        expect(ast.metrics).toEqual([
            {
                type: "metric",
                name: "newCount",
            },
        ]);
        expect(ast.filters).toEqual([]);
        expect(ast.orderBy).toEqual([]);
        expect(ast.limit).toBe(DEFAULT_LIMIT);
        expect(ast.offset).toBe(0);
    });
    it("builds multiple axis nodes", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: [
                "department",
                "businessUnit",
            ],
            metrics: ["newCount"],
        });
        const ast = buildQueryAST(query);
        expect(ast.axes).toEqual([
            {
                type: "axis",
                name: "department",
            },
            {
                type: "axis",
                name: "businessUnit",
            },
        ]);
    });
    it("builds multiple metric nodes", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: [
                "newCount",
                "pendingCount",
                "assignedCount",
            ],
        });
        const ast = buildQueryAST(query);
        expect(ast.metrics).toEqual([
            {
                type: "metric",
                name: "newCount",
            },
            {
                type: "metric",
                name: "pendingCount",
            },
            {
                type: "metric",
                name: "assignedCount",
            },
        ]);
    });
    it("builds filter nodes", () => {
        const query = parseAxisQuery({
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
        const ast = buildQueryAST(query);
        expect(ast.filters).toEqual([
            {
                type: "filter",
                field: "status",
                operator: "equals",
                value: 1,
            },
        ]);
    });
    it("builds multiple filter nodes", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                {
                    field: "status",
                    operator: "equals",
                    value: 1,
                },
                {
                    field: "department",
                    operator: "equals",
                    value: "Chemical",
                },
            ],
        });
        const ast = buildQueryAST(query);
        expect(ast.filters).toEqual([
            {
                type: "filter",
                field: "status",
                operator: "equals",
                value: 1,
            },
            {
                type: "filter",
                field: "department",
                operator: "equals",
                value: "Chemical",
            },
        ]);
    });
    it("builds filters with array values", () => {
        const query = parseAxisQuery({
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
        const ast = buildQueryAST(query);
        expect(ast.filters).toEqual([
            {
                type: "filter",
                field: "department",
                operator: "in",
                value: [
                    "Chemical",
                    "TBWES",
                ],
            },
        ]);
    });
    it("builds a filter without a value", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                {
                    field: "deletedAt",
                    operator: "isNull",
                },
            ],
        });
        const ast = buildQueryAST(query);
        expect(ast.filters).toEqual([
            {
                type: "filter",
                field: "deletedAt",
                operator: "isNull",
            },
        ]);
        expect("value" in ast.filters[0]).toBe(false);
    });
    it("builds orderBy nodes", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            orderBy: [
                {
                    field: "newCount",
                    direction: "desc",
                },
            ],
        });
        const ast = buildQueryAST(query);
        expect(ast.orderBy).toEqual([
            {
                type: "orderBy",
                field: "newCount",
                direction: "desc",
            },
        ]);
    });
    it("builds multiple orderBy nodes", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: ["department"],
            metrics: ["newCount"],
            orderBy: [
                {
                    field: "newCount",
                    direction: "desc",
                },
                {
                    field: "department",
                    direction: "asc",
                },
            ],
        });
        const ast = buildQueryAST(query);
        expect(ast.orderBy).toEqual([
            {
                type: "orderBy",
                field: "newCount",
                direction: "desc",
            },
            {
                type: "orderBy",
                field: "department",
                direction: "asc",
            },
        ]);
    });
    it("uses the default limit when limit is not provided", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
        });
        const ast = buildQueryAST(query);
        expect(ast.limit).toBe(DEFAULT_LIMIT);
    });
    it("preserves an explicitly provided limit", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            limit: 500,
        });
        const ast = buildQueryAST(query);
        expect(ast.limit).toBe(500);
    });
    it("defaults offset to zero", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
        });
        const ast = buildQueryAST(query);
        expect(ast.offset).toBe(0);
    });
    it("preserves an explicitly provided offset", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            offset: 200,
        });
        const ast = buildQueryAST(query);
        expect(ast.offset).toBe(200);
    });
    it("builds a complete query AST", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: [
                "department",
                "businessUnit",
            ],
            metrics: [
                "newCount",
                "pendingCount",
                "assignedCount",
            ],
            filters: [
                {
                    field: "status",
                    operator: "equals",
                    value: 1,
                },
                {
                    field: "department",
                    operator: "in",
                    value: [
                        "Chemical",
                        "TBWES",
                    ],
                },
            ],
            orderBy: [
                {
                    field: "newCount",
                    direction: "desc",
                },
            ],
            limit: 50,
            offset: 10,
        });
        const ast = buildQueryAST(query);
        expect(ast).toEqual({
            model: "PurchaseRequisitions",
            axes: [
                {
                    type: "axis",
                    name: "department",
                },
                {
                    type: "axis",
                    name: "businessUnit",
                },
            ],
            metrics: [
                {
                    type: "metric",
                    name: "newCount",
                },
                {
                    type: "metric",
                    name: "pendingCount",
                },
                {
                    type: "metric",
                    name: "assignedCount",
                },
            ],
            filters: [
                {
                    type: "filter",
                    field: "status",
                    operator: "equals",
                    value: 1,
                },
                {
                    type: "filter",
                    field: "department",
                    operator: "in",
                    value: [
                        "Chemical",
                        "TBWES",
                    ],
                },
            ],
            orderBy: [
                {
                    type: "orderBy",
                    field: "newCount",
                    direction: "desc",
                },
            ],
            limit: 50,
            offset: 10,
        });
    });
});
//# sourceMappingURL=builder.test.js.map