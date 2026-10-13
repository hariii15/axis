export var ExecutionTarget;
(function (ExecutionTarget) {
    ExecutionTarget["POSTGRESQL"] = "postgresql";
    ExecutionTarget["OPENSEARCH"] = "opensearch";
    ExecutionTarget["S3_STATISTICS"] = "s3_statistics";
    /** S3 JSON source data + Axis query execution (Architecture C JSON). */
    ExecutionTarget["S3_JSON"] = "s3_json";
    /** S3 Parquet source data + Axis query execution (Architecture C Parquet). */
    ExecutionTarget["S3_PARQUET"] = "s3_parquet";
})(ExecutionTarget || (ExecutionTarget = {}));
export const DATA_SOURCE_NAMES = [
    "opensearch",
    "s3-json",
    "s3-parquet",
];
export function executionTargetForDataSource(name) {
    switch (name) {
        case "opensearch":
            return ExecutionTarget.OPENSEARCH;
        case "s3-json":
            return ExecutionTarget.S3_JSON;
        case "s3-parquet":
            return ExecutionTarget.S3_PARQUET;
    }
}
//# sourceMappingURL=types.js.map