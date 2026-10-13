import { describe, expect, it } from "vitest";
import { DEFAULT_LIMIT, FILTER_OPERATORS, MAX_LIMIT, ORDER_DIRECTIONS, } from "../../src/core/query/schema.js";
import { isAxisQuery, isFilter, isFilterOperator, isFilterValue, isOrderBy, parseAxisQuery, parseFilter, parseOrderBy, validateAxisQuery, validateFilter, validateOrderBy, ValidationError, } from "../../src/core/query/validator.js";
describe("schema constants", () => {
    it("exposes the supported filter operators", () => {
        expect([...FILTER_OPERATORS]).toEqual([
            "equals",
            "notEquals",
            "greaterThan",
            "greaterThanOrEqual",
            "lessThan",
            "lessThanOrEqual",
            "in",
            "notIn",
            "contains",
            "startsWith",
            "endsWith",
            "isNull",
            "isNotNull",
        ]);
    });
    it("exposes the supported order directions and limits", () => {
        expect([...ORDER_DIRECTIONS]).toEqual(["asc", "desc"]);
        expect(DEFAULT_LIMIT).toBe(100);
        expect(MAX_LIMIT).toBe(10_000);
    });
});
describe("filter validation", () => {
    it("accepts scalar filter values", () => {
        for (const value of ["Chemical", 1, true, null]) {
            const result = validateFilter({
                field: "status",
                operator: "equals",
                value,
            });
            expect(result.success).toBe(true);
        }
    });
    it("accepts homogeneous array values and empty arrays", () => {
        expect(validateFilter({ field: "dept", operator: "in", value: ["a", "b"] })
            .success).toBe(true);
        expect(validateFilter({ field: "count", operator: "in", value: [1, 2] })
            .success).toBe(true);
        expect(validateFilter({ field: "flag", operator: "in", value: [true] })
            .success).toBe(true);
        expect(validateFilter({ field: "dept", operator: "in", value: [] }).success)
            .toBe(true);
    });
    it("accepts a filter without a value", () => {
        const filter = parseFilter({ field: "deletedAt", operator: "isNull" });
        expect(filter.field).toBe("deletedAt");
        expect(filter.operator).toBe("isNull");
        expect("value" in filter).toBe(false);
    });
    it("rejects an empty field and an unknown operator", () => {
        const emptyField = validateFilter({ field: "", operator: "equals" });
        expect(emptyField.success).toBe(false);
        const badOperator = validateFilter({ field: "status", operator: "invalid" });
        expect(badOperator.success).toBe(false);
        if (!badOperator.success) {
            expect(badOperator.issues[0]?.path).toEqual(["operator"]);
        }
    });
    it("rejects mixed arrays and NaN", () => {
        expect(validateFilter({ field: "x", operator: "in", value: [1, "a"] }).success).toBe(false);
        expect(validateFilter({ field: "x", operator: "equals", value: NaN }).success)
            .toBe(false);
        expect(validateFilter(null).success).toBe(false);
        expect(validateFilter([]).success).toBe(false);
    });
    it("throws a ValidationError from parseFilter on invalid input", () => {
        expect(() => parseFilter({ field: "", operator: "nope" })).toThrow(ValidationError);
    });
    it("exposes boolean type guards", () => {
        expect(isFilter({ field: "s", operator: "equals", value: 1 })).toBe(true);
        expect(isFilter({ field: "", operator: "equals" })).toBe(false);
        expect(isFilterOperator("in")).toBe(true);
        expect(isFilterOperator("invalid")).toBe(false);
        expect(isFilterValue(["a", "b"])).toBe(true);
        expect(isFilterValue([1, "a"])).toBe(false);
    });
});
describe("orderBy validation", () => {
    it("accepts asc and desc", () => {
        expect(validateOrderBy({ field: "newCount", direction: "asc" }).success).toBe(true);
        expect(validateOrderBy({ field: "newCount", direction: "desc" }).success).toBe(true);
    });
    it("rejects a bad direction and an empty field", () => {
        const badDirection = validateOrderBy({
            field: "newCount",
            direction: "random",
        });
        expect(badDirection.success).toBe(false);
        if (!badDirection.success) {
            expect(badDirection.issues[0]?.path).toEqual(["direction"]);
        }
        expect(validateOrderBy({ field: "", direction: "asc" }).success).toBe(false);
    });
    it("throws a ValidationError from parseOrderBy on invalid input", () => {
        expect(() => parseOrderBy({ field: "x", direction: "sideways" })).toThrow(ValidationError);
    });
    it("exposes a boolean type guard", () => {
        expect(isOrderBy({ field: "x", direction: "asc" })).toBe(true);
        expect(isOrderBy({ field: "x", direction: "up" })).toBe(false);
    });
});
describe("axis query validation", () => {
    it("accepts a valid query", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: ["department"],
            metrics: ["newCount", "pendingCount", "assignedCount"],
            filters: [{ field: "status", operator: "equals", value: 1 }],
            orderBy: [{ field: "newCount", direction: "desc" }],
            limit: 100,
            offset: 0,
        });
        expect(query.model).toBe("PurchaseRequisitions");
        expect(query.axes).toEqual(["department"]);
        expect(query.metrics).toEqual([
            "newCount",
            "pendingCount",
            "assignedCount",
        ]);
    });
    it("accepts a query with only axes", () => {
        const result = validateAxisQuery({
            model: "PurchaseRequisitions",
            axes: ["department"],
        });
        expect(result.success).toBe(true);
    });
    it("accepts a query with only metrics", () => {
        const result = validateAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
        });
        expect(result.success).toBe(true);
    });
    it("rejects a query without axes or metrics", () => {
        const result = validateAxisQuery({ model: "PurchaseRequisitions" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.issues[0]?.path).toEqual(["axes"]);
        }
        expect(() => parseAxisQuery({ model: "PurchaseRequisitions" })).toThrow(ValidationError);
    });
    it("rejects a missing model", () => {
        expect(() => parseAxisQuery({ metrics: ["newCount"] })).toThrow(ValidationError);
    });
    it("rejects an invalid filter operator", () => {
        expect(() => parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [{ field: "status", operator: "invalid", value: 1 }],
        })).toThrow(ValidationError);
    });
    it("rejects an invalid order direction", () => {
        expect(() => parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            orderBy: [{ field: "newCount", direction: "random" }],
        })).toThrow(ValidationError);
    });
    it("rejects a negative limit", () => {
        expect(() => parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            limit: -10,
        })).toThrow(ValidationError);
    });
    it("rejects a negative offset", () => {
        expect(() => parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            offset: -1,
        })).toThrow(ValidationError);
    });
    it("accepts an IN filter", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            metrics: ["newCount"],
            filters: [
                { field: "department", operator: "in", value: ["Chemical", "TBWES"] },
            ],
        });
        expect(query.filters?.[0]?.operator).toBe("in");
    });
    it("strips unknown keys", () => {
        const query = parseAxisQuery({
            model: "PurchaseRequisitions",
            axes: ["department"],
            extra: "strip",
        });
        expect(query).not.toHaveProperty("extra");
    });
    it("exposes a boolean type guard", () => {
        expect(isAxisQuery({ model: "m", axes: ["a"] })).toBe(true);
        expect(isAxisQuery({ model: "m" })).toBe(false);
    });
});
//# sourceMappingURL=validator.test.js.map