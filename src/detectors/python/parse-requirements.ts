import type { DirectDependency, ResolvedVersions } from "./types.js";
import { addDependency, addExactPin, parseRequirement } from "./shared.js";

export function collectRequirementsFile(
  path: string,
  contents: string,
  target: Map<string, DirectDependency>,
  resolved: ResolvedVersions,
): void {
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const requirement = parseRequirement(line);
    if (!requirement) continue;
    addDependency(target, path, contents, requirement.name, requirement.constraint, index + 1);
    addExactPin(resolved, requirement.name, requirement.constraint);
  }
}
