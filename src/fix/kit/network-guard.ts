import * as nodeModule from "node:module";

const network = new Set(["dgram", "dns", "dns/promises", "http", "http2", "https", "net", "tls"]);
const hookSupport: { registerHooks?: typeof nodeModule.registerHooks } = nodeModule;

/** Blocks access to network entry points in the reviewed planner process. */
export function blockNetwork(): () => void {
  let attempted = false;
  const deny = (): never => {
    attempted = true;
    throw new Error("Codemod planning cannot use the network.");
  };
  const registerHooks = hookSupport.registerHooks;
  if (!registerHooks) throw new Error("Codemod conformance requires Node.js 22.15 or newer.");
  function check(module: string): void {
    if (network.has(module.replace(/^node:/u, ""))) deny();
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      check(specifier);
      return nextResolve(specifier, context);
    },
  });
  const loadBuiltin = process.getBuiltinModule.bind(process);
  Object.defineProperty(process, "getBuiltinModule", {
    value(module: string) {
      check(module);
      return loadBuiltin(module);
    },
  });
  for (const name of ["fetch", "WebSocket"]) Object.defineProperty(globalThis, name, { value: deny });
  return () => {
    if (attempted) deny();
  };
}
