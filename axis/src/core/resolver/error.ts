export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}