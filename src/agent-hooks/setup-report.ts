import type { InitClaudeHooksResult } from "../init-agents.js";

/** What `init --hooks-for <host>` prints for one host hooks file; one shape for every host. */
export function hooksFileReport(
  result: InitClaudeHooksResult,
  dryRun: boolean,
  remove: boolean | undefined,
  done: string,
): string {
  if (remove) {
    if (result.change === "unchanged") return "";
    return `${dryRun ? "Would remove" : "Removed"} the Offing post-edit hook from ${result.file}.\n`;
  }
  if (result.change === "unchanged")
    return `${result.file} already has the current Offing post-edit hook; nothing to change.\n`;
  const verb = result.change === "created" ? "create" : "update";
  if (dryRun) {
    const detail = result.change === "created" ? result.diff : done;
    return `Would ${verb} ${result.file}:\n\n${detail}\n`;
  }
  return `${result.change === "created" ? "Created" : "Updated"} ${result.file}; ${done}\n`;
}
