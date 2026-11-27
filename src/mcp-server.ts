import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createOffingMcpServer } from "./mcp.js";
import { readStackContext } from "./stack-context-local.js";
import { stackSummary } from "./stack-context.js";

/** Serves Offing's MCP tools, resources, and prompt over stdio until the host closes the connection. */
export async function startMcpServer(): Promise<void> {
  const context = await readStackContext(".", "cached").catch(() => undefined);
  const initialStack = context === undefined ? undefined : stackSummary(context);
  serveStdio(() => createOffingMcpServer(undefined, initialStack), {
    onerror(error) {
      process.stderr.write(`Offing MCP error: ${error.message}\n`);
    },
  });
}
