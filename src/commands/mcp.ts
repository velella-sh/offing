import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "mcp",
  flags: [],
  example: "offing mcp",
  usage: ["  offing mcp"],
  usageSlots: [41],
  async run() {
    // The server's stdin listener keeps the process alive until the host disconnects.
    await (await import("../mcp-server.js")).startMcpServer();
    return 0;
  },
};
