import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "lsp",
  flags: [],
  example: "offing lsp",
  usage: ["  offing lsp"],
  usageSlots: [66],
  async run() {
    // The language server owns stdin and stdout until the editor disconnects, so there is no exit code to return.
    (await import("../lsp/server.js")).startLanguageServer();
    return await new Promise<number>(() => undefined);
  },
};
