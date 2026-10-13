export class DatabaseError extends Error {
    code;
    cause;
    constructor(message, code, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "DatabaseError";
    }
}
//# sourceMappingURL=errors.js.map