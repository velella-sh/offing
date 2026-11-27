import { bundledRules } from "@velella/ebb/bundled-rules";
import type { ScanResult } from "../domain.js";
import { createMigrationPacket } from "../migration-packet.js";
import { renderMigrationPrompt } from "../migration-prompt.js";
import { readPinnedRuntimes } from "../runtime-pin.js";

export async function buildFindingPrompt(scan: ScanResult, findingId: string, worktree: string) {
  const packet = createMigrationPacket(scan, findingId, await bundledRules(), await readPinnedRuntimes(worktree));
  return {
    prompt: renderMigrationPrompt(packet, worktree),
    affectedFiles: packet.affectedFiles,
  };
}
