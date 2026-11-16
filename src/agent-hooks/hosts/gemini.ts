import { initGeminiHooks } from "../../init-agents.js";
import { geminiAdapter } from "../gemini.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: geminiAdapter,
  stability: "beta",
  markers: [".gemini"],
  binaries: ["gemini"],
  async setup(options) {
    const { dryRun, remove } = options;
    return hooksFileReport(
      await initGeminiHooks(options),
      dryRun,
      remove,
      "Gemini CLI now runs Offing after write_file and replace.",
    );
  },
};
