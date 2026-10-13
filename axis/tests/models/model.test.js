import { describe, expect, it } from "vitest";
import { defineModel } from "../../src/model/model.js";
describe("defineModel", () => {
    it("creates a model definition", () => {
        const model = defineModel({
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
            },
            metrics: {
                newCount: {
                    type: "count",
                },
            },
        });
        expect(model.name).toBe("PurchaseRequisitions");
        expect(model.source).toEqual({
            type: "table",
            table: "upeg.requisition_deails",
        });
        expect(model.axes.department).toEqual({
            sql: "department_name",
            type: "string",
        });
        expect(model.metrics.newCount).toEqual({
            type: "count",
        });
    });
});
//# sourceMappingURL=model.test.js.map