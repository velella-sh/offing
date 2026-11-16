import { initClaudeHooks } from "../../init-agents.js";
import { claudeCodeAdapter } from "../claude-code.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: claudeCodeAdapter,
  stability: "stable",
  markers: [".claude"],
  binaries: ["claude"],
  async setup(options) {
    const { dryRun, remove } = options;
    return hooksFileReport(
      await initClaudeHooks(options),
      dryRun,
      remove,
      "Claude Code now runs Offing after Write, Edit, and MultiEdit.",
    );
  },
};
