import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "mcp",
  flags: [],
  example: "offing mcp",
  usage: ["  offing mcp"],
  usageSlots: [41],
  async run() {
    // The MCP server owns stdin and stdout until the host disconnects, so there is no exit code to return.
    (await import("../mcp-server.js")).startMcpServer();
    return await new Promise<number>(() => undefined);
  },
};
