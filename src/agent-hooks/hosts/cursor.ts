import { initCursorHooks } from "../../init-agents.js";
import type { InitCursorHooksResult } from "../../init-agents.js";
import { cursorAdapter } from "../cursor.js";
import { hooksFileReport } from "../setup-report.js";
import type { HostHook } from "../types.js";

/** What `init` prints for the Cursor rule that accompanies the hooks-file merge. */
function ruleReport(result: InitCursorHooksResult["rule"], dryRun: boolean): string {
  if (result.change === "unchanged")
    return `${result.file} already has the current Offing section; nothing to change.\n`;
  if (dryRun) {
    const verb =
      result.change === "created" ? "create" : result.change === "added" ? "add the Offing section to" : "update";
    return `Would ${verb} ${result.file}: Offing dependency-check instructions.\n`;
  }
  if (result.change === "created") return `Created ${result.file}.\n`;
  if (result.change === "added") return `Added the Offing section to ${result.file}.\n`;
  return `Updated the Offing section in ${result.file}.\n`;
}

export const hostHook: HostHook = {
  adapter: cursorAdapter,
  stability: "stable",
  markers: [".cursor"],
  binaries: ["cursor", "cursor-agent"],
  async setup(options) {
    const { dryRun, remove } = options;
    const result = await initCursorHooks(options);
    return (
      hooksFileReport(
        result.hooks,
        dryRun,
        remove,
        "Cursor now runs Offing afterFileEdit (audit log only; the agent reads .cursor/rules/offing.mdc).",
      ) + (remove ? "" : ruleReport(result.rule, dryRun))
    );
  },
};
