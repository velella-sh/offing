import { bundledRules } from "@velella/ebb/bundled-rules";
import type { ScanResult } from "../domain.js";
import { createMigrationPacket } from "../migration-packet.js";
import { renderMigrationPrompt } from "../migration-prompt.js";
import { readPinnedRuntimes } from "../runtime-pin.js";

export async function buildFindingPacket(scan: ScanResult, findingId: string, worktree: string) {
  return createMigrationPacket(scan, findingId, await bundledRules(), await readPinnedRuntimes(worktree));
}

export async function buildFindingPrompt(scan: ScanResult, findingId: string, worktree: string) {
  const packet = await buildFindingPacket(scan, findingId, worktree);
  return {
    prompt: renderMigrationPrompt(packet, worktree),
    affectedFiles: packet.affectedFiles,
  };
}
