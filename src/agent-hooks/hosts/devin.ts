import { initDevinHooks } from "../../init-agents.js";
import { devinAdapter } from "../devin.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

export const hostHook: HostHook = {
  adapter: devinAdapter,
  stability: "beta",
  markers: [".devin"],
  binaries: ["devin"],
  async setup(options) {
    const { dryRun, remove } = options;
    return hooksFileReport(
      await initDevinHooks(options),
      dryRun,
      remove,
      "Devin Local now runs Offing after write, edit, and apply_patch.",
    );
  },
};
