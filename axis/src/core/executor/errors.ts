export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly sql?: string,
    public readonly parameters?: unknown[],
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}