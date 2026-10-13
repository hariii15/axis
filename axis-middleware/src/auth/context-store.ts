// Moved from axis/src/core/context/context.ts (legacy module-global store).
// Prefer passing AxisContext explicitly (req.axisContext); this store is
// kept only for backward compatibility and is NOT request-scoped.
import type { RequestContext } from "./context-types.js";

let currentContext: RequestContext | undefined;

export function setContext(context: RequestContext): void {
  currentContext = context;
}

export function getContext(): RequestContext {
  if (!currentContext) {
    throw new Error("Request context has not been initialized.");
  }

  return currentContext;
}

export function clearContext(): void {
  currentContext = undefined;
}
