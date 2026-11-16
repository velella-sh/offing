import { initClineHooks } from "../../init-agents.js";
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
    return hooksFileReport(
      await initClineHooks(options),
      dryRun,
      remove,
      "Cline now runs Offing after write_to_file and replace_in_file; turn on Hooks in Cline's feature settings.",
    );
  },
};
