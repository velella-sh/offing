import { runScanPipeline } from "./runtime.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "context",
  flags: ["--json", "--data-version"],
  example: "offing context <finding-id> .",
  usage: ["  offing context <finding-id> [path] [--json]"],
  usageSlots: [61],
  run(args, ctx) {
    return runScanPipeline("context", args, ctx);
  },
};
