import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createOffingMcpServer } from "./mcp.js";

/** Serves Offing's MCP tools, resources, and prompt over stdio until the host closes the connection. */
export function startMcpServer(): void {
  serveStdio(() => createOffingMcpServer(), {
    onerror(error) {
      process.stderr.write(`Offing MCP error: ${error.message}\n`);
    },
  });
}
