import { initCodexHooks } from "../../init-agents.js";
import { codexAdapter } from "../codex.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: codexAdapter,
  stability: "stable",
  markers: [".codex"],
  binaries: ["codex"],
  async setup(options) {
    const { dryRun, remove } = options;
    return hooksFileReport(await initCodexHooks(options), dryRun, remove, "Codex now runs Offing after apply_patch.");
  },
};
