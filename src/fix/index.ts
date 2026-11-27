import type { ScanResult } from "../domain.js";
import { fixers } from "./registry.generated.js";
import type { FilePatch, FixPlan, Fixer, FixerPatch, FixRefusal, Refuse } from "./types.js";

export type { FilePatch, FixPlan, FixRefusal, Fixer, FixerPatch } from "./types.js";
export * from "./registry.generated.js";
export { renderPatches } from "./render-patches.js";

/**
 * Plans every fixer over a scan and returns the patches with the fixer that produced them, ordered by file, along with
 * the findings each fixer declined and why. Both lists are deterministic.
 */
export async function planFixReport(result: ScanResult, available: Fixer[] = fixers): Promise<FixPlan> {
  const patches: FixerPatch[] = [];
  const refusals: FixRefusal[] = [];
  for (const fixer of available) {
    const refuse: Refuse = (finding, reason) => {
      refusals.push({
        fixer: fixer.id,
        findingId: finding.id,
        ruleId: finding.ruleId,
        path: finding.location.path,
        ...(finding.location.line === undefined ? {} : { line: finding.location.line }),
        reason,
      });
    };
    for (const patch of await fixer.plan(result, refuse)) patches.push({ ...patch, fixer: fixer.id });
  }
  patches.sort((a, b) => a.path.localeCompare(b.path));
  refusals.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.findingId.localeCompare(b.findingId) ||
      a.fixer.localeCompare(b.fixer) ||
      a.reason.localeCompare(b.reason),
  );
  return { patches, refusals };
}

/** Plans every fixer over a scan and returns the patches ordered by file, then fixer. */
export async function planFixes(result: ScanResult, available: Fixer[] = fixers): Promise<FilePatch[]> {
  return (await planFixReport(result, available)).patches.map(({ path, diff }) => ({ path, diff }));
}
