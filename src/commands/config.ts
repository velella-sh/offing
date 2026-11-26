import process from "node:process";

import { inspectConfig, renderConfigDiagnostic } from "../config-validate.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "config",
  flags: ["--json"],
  example: "offing config validate",
  usage: ["  offing config validate [path] [--json]"],
  completion: { subcommands: ["validate"], extraWords: ["--json"] },
  async run(args, ctx) {
    const operands = args.filter((argument) => argument !== "--json");
    const [subcommand, path] = operands;
    if (subcommand !== "validate" || operands.length > 2 || path?.startsWith("-")) {
      return ctx.fail("usage", "Usage: offing config validate [path] [--json]");
    }
    const result = await inspectConfig(path);
    if (ctx.jsonErrors) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const item of result.diagnostics) process.stderr.write(`${renderConfigDiagnostic(item)}\n`);
      if (result.valid)
        process.stdout.write(result.file ? `Valid Offing config: ${result.file}\n` : "No Offing config found.\n");
    }
    return result.valid ? 0 : ctx.exitCodes.usage;
  },
};
