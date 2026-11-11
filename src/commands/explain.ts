import { runScanPipeline } from "./runtime.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "explain",
  flags: ["--json", "--data-version"],
  example: "offing explain <finding-id> .",
  usage: ["  offing explain <finding-id> [path] [--json]"],
  usageSlots: [60],
  run(args, ctx) {
    return runScanPipeline("explain", args, ctx);
  },
};
