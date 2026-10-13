import { CompilationError } from "./errors.js";
export function compileQuery(query) {
    const parameters = [];
    const selectParts = [];
    for (const axis of query.axes) {
        selectParts.push(`${axis.definition.sql} AS "${axis.name}"`);
    }
    for (const metric of query.metrics) {
        selectParts.push(compileMetric(metric));
    }
    if (selectParts.length === 0) {
        throw new CompilationError("Query must contain at least one axis or metric.");
    }
    const sql = [
        `SELECT ${selectParts.join(", ")}`,
        `FROM ${query.model.source.type === "table"
            ? query.model.source.table
            : compileSource(query)}`,
        compileWhere(query, parameters),
        compileGroupBy(query),
        compileOrderBy(query),
        compileLimit(query, parameters),
        compileOffset(query, parameters),
    ]
        .filter(Boolean)
        .join(" ");
    return {
        sql,
        parameters,
    };
}
function compileSource(query) {
    const source = query.model.source;
    if (source.type === "sql") {
        return `(${source.sql})`;
    }
    if (source.type === "function") {
        const args = source.args?.join(", ") ?? "";
        return `${source.name}(${args})`;
    }
    return source.table;
}
function compileMetric(metric) {
    const { definition } = metric;
    switch (definition.type) {
        case "count":
            return definition.sql
                ? `COUNT(${definition.sql}) AS "${metric.name}"`
                : `COUNT(*) AS "${metric.name}"`;
        case "countDistinct":
            if (!definition.sql) {
                throw new CompilationError(`Metric "${metric.name}" requires sql for countDistinct.`);
            }
            return `COUNT(DISTINCT ${definition.sql}) AS "${metric.name}"`;
        case "sum":
            return compileAggregate("SUM", metric);
        case "avg":
            return compileAggregate("AVG", metric);
        case "min":
            return compileAggregate("MIN", metric);
        case "max":
            return compileAggregate("MAX", metric);
        default:
            throw new CompilationError(`Unsupported metric type "${definition.type}".`);
    }
}
function compileAggregate(functionName, metric) {
    if (!metric.definition.sql) {
        throw new CompilationError(`Metric "${metric.name}" requires sql.`);
    }
    return `${functionName}(${metric.definition.sql}) AS "${metric.name}"`;
}
function compileWhere(query, parameters) {
    const conditions = [];
    for (const filter of query.filters) {
        conditions.push(compileFilter(query, filter.node, parameters));
    }
    for (const metric of query.metrics) {
        if (!metric.definition.filters) {
            continue;
        }
        for (const filter of metric.definition.filters) {
            conditions.push(compileFilter(query, filter, parameters));
        }
    }
    if (conditions.length === 0) {
        return "";
    }
    return `WHERE ${conditions.join(" AND ")}`;
}
/**
 * Resolve a filter field to SQL. Axis names expand to their `sql`
 * expression (which may be a plain column or a computed expression
 * such as `EXISTS (...)`); anything else passes through verbatim for
 * backward compatibility (raw column references).
 */
function fieldSql(query, field) {
    return query.model.axes[field]?.sql ?? field;
}
function compileFilter(query, filter, parameters) {
    const field = fieldSql(query, filter.field);
    switch (filter.operator) {
        case "equals":
            return addParameter(`${field} = ?`, filter.value, parameters);
        case "notEquals":
            return addParameter(`${field} <> ?`, filter.value, parameters);
        case "greaterThan":
            return addParameter(`${field} > ?`, filter.value, parameters);
        case "greaterThanOrEqual":
            return addParameter(`${field} >= ?`, filter.value, parameters);
        case "lessThan":
            return addParameter(`${field} < ?`, filter.value, parameters);
        case "lessThanOrEqual":
            return addParameter(`${field} <= ?`, filter.value, parameters);
        case "contains":
            return addParameter(`${field} LIKE ?`, `%${filter.value}%`, parameters);
        case "startsWith":
            return addParameter(`${field} LIKE ?`, `${filter.value}%`, parameters);
        case "endsWith":
            return addParameter(`${field} LIKE ?`, `%${filter.value}`, parameters);
        case "in":
            return compileInFilter(field, filter.value, false, parameters);
        case "notIn":
            return compileInFilter(field, filter.value, true, parameters);
        case "isNull":
            return `${field} IS NULL`;
        case "isNotNull":
            return `${field} IS NOT NULL`;
        default:
            throw new CompilationError(`Unsupported filter operator "${filter.operator}".`);
    }
}
function compileInFilter(field, value, negate, parameters) {
    if (!Array.isArray(value)) {
        throw new CompilationError(`Operator "${negate ? "notIn" : "in"}" requires an array.`);
    }
    if (value.length === 0) {
        return negate ? "1 = 1" : "1 = 0";
    }
    const placeholders = value.map((item) => {
        const name = `param${parameters.length}`;
        parameters.push({
            name,
            value: item,
        });
        return "?";
    });
    return `${field} ${negate ? "NOT IN" : "IN"} (${placeholders.join(", ")})`;
}
function addParameter(expression, value, parameters) {
    parameters.push({
        name: `param${parameters.length}`,
        value,
    });
    return expression;
}
function compileGroupBy(query) {
    if (query.axes.length === 0) {
        return "";
    }
    const axes = query.axes.map((axis) => axis.definition.sql);
    return `GROUP BY ${axes.join(", ")}`;
}
function compileOrderBy(query) {
    if (query.orderBy.length === 0) {
        return "";
    }
    const fields = query.orderBy.map((order) => `${order.field.definition.sql ?? order.field.name} ${order.node.direction.toUpperCase()}`);
    return `ORDER BY ${fields.join(", ")}`;
}
function compileLimit(query, parameters) {
    parameters.push({
        name: `param${parameters.length}`,
        value: query.limit,
    });
    return "LIMIT ?";
}
function compileOffset(query, parameters) {
    if (query.offset === 0) {
        return "";
    }
    parameters.push({
        name: `param${parameters.length}`,
        value: query.offset,
    });
    return "OFFSET ?";
}
//# sourceMappingURL=compiler.js.map