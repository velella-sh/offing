import process from "node:process";

import { guardOptionCount } from "../cli-args.js";
import { guardCommand, GuardUsageError } from "../guard.js";
import { afterGates } from "./runtime.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "guard",
  flags: ["--fail-on", "--allow", "--force", "--verbose", "--data-version", "--protocol"],
  example: "offing guard npm install request",
  usage: [
    "  offing guard [--fail-on <severity|none>] [--allow <purl>] [--force] [--verbose] <manager> <install|add> <package>...",
    "  offing guard --protocol   # read one Agent Guard v1 JSON request from stdin",
  ],
  usageSlots: [39, 39.5],
  async run(args, ctx) {
    if (args[0] === "--protocol") {
      if (args.length !== 1) return ctx.fail("usage", "Use offing guard --protocol without other arguments.");
      const { runGuardProtocol } = await import("./internal/guard-protocol.js");
      return runGuardProtocol(ctx);
    }
    return afterGates("guard", args.slice(0, guardOptionCount(args)), ctx, async ({ config }) => {
      try {
        const result = await guardCommand(args, {
          ...(config?.failOn === undefined ? {} : { failOn: config.failOn }),
          report: (output) => process.stderr.write(`${output}\n`),
        });
        return result.exitCode;
      } catch (error) {
        if (error instanceof GuardUsageError) return ctx.failError(error);
        throw error;
      }
    });
  },
};
