import { adapterRegistry } from "../core/registry";
import { typescriptAdapter } from "./languages/typescript";
import { expressAdapter } from "./frameworks/express";
import { nestjsAdapter } from "./frameworks/nestjs";
import { reactAdapter } from "./frameworks/react";

/**
 * The one place adapters are registered. Core, storage and retrieval never
 * import an adapter directly — they go through the registry — so adding Java
 * or C# later is a change to this file and a new adapter, nothing else.
 *
 * Registration is idempotent: tests import this module repeatedly.
 */
let registered = false;

export const registerBuiltinAdapters = (): void => {
  if (registered) return;
  registered = true;
  adapterRegistry.registerLanguage(typescriptAdapter);
  adapterRegistry.registerFramework(expressAdapter);
  adapterRegistry.registerFramework(nestjsAdapter);
  adapterRegistry.registerFramework(reactAdapter);
};
