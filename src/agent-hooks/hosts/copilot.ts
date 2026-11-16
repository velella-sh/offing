import { initCopilotHooks } from "../../init-agents.js";
import { copilotAdapter } from "../copilot.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: copilotAdapter,
  stability: "beta",
  markers: [".copilot", ".github/hooks", ".github/copilot-instructions.md"],
  binaries: ["copilot"],
  async setup(options) {
    const { dryRun, remove } = options;
    return hooksFileReport(
      await initCopilotHooks(options),
      dryRun,
      remove,
      "GitHub Copilot now runs Offing after create and edit.",
    );
  },
};
