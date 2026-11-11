import { runScanPipeline } from "./runtime.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "baseline",
  flags: ["--output", "--data-version"],
  example: "offing baseline . --output offing-baseline.json",
  usage: ["  offing baseline [path] [--output <file>]"],
  usageSlots: [36],
  run(args, ctx) {
    return runScanPipeline("baseline", args, ctx);
  },
};
