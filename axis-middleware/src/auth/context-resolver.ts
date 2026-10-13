// Moved from axis/src/core/context/resolver.ts (legacy global-store helper).
// New code should pass AxisContext explicitly instead of using setContext.
import { resolveJWTContext } from "./jwt.js";
import { setContext } from "./context-store.js";
import type { JWTConfig, RequestContext } from "./context-types.js";

export function resolveContext(token: string, config: JWTConfig): RequestContext {
  const context = resolveJWTContext(token, config);

  setContext(context);

  return context;
}
