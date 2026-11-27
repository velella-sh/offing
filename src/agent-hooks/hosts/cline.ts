import { initClineHooks, initClineSessionStart } from "../../init-agents.js";
import { clineAdapter } from "../cline.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: clineAdapter,
  stability: "beta",
  markers: [".cline", ".clinerules"],
  binaries: ["cline"],
  async setup(options) {
    const { dryRun, remove } = options;
    const postEdit = await initClineHooks(options);
    const session = await initClineSessionStart(options);
    const report = hooksFileReport(
      postEdit,
      dryRun,
      remove,
      "Cline now runs Offing after write_to_file and replace_in_file; turn on Hooks in Cline's feature settings.",
    );
    if (session.change === "unchanged") return report;
    const verb = remove ? (dryRun ? "Would remove" : "Removed") : dryRun ? "Would install" : "Installed";
    return `${report}${verb} Offing session-start context at ${session.file}.\n`;
  },
};
