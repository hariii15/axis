export class ExecutionError extends Error {
    cause;
    sql;
    parameters;
    constructor(message, cause, sql, parameters) {
        super(message);
        this.cause = cause;
        this.sql = sql;
        this.parameters = parameters;
        this.name = "ExecutionError";
    }
}
//# sourceMappingURL=errors.js.map