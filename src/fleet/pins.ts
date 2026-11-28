import { FleetHostError } from "./host.js";

export interface FleetPin {
  readonly repository: string;
  readonly commit: string;
  readonly branch?: string;
}

const pinPattern = /^github\/([a-z\d][a-z\d-]*\/[a-z\d_.-]+)@([a-f\d]{40})$/i;

export function parseFleetPins(lines: readonly string[]): FleetPin[] {
  if (lines.length === 0) throw new FleetHostError("Pinned --repos file has no repository pins.");
  const names = new Set<string>();
  return lines.map((line) => {
    const [, repository, commit] = pinPattern.exec(line) ?? [];
    if (!repository || !commit || repository.endsWith(".") || names.has(repository.toLowerCase())) {
      throw new FleetHostError("Pinned --repos needs unique github/owner/repository@40-character-SHA lines.");
    }
    names.add(repository.toLowerCase());
    return { repository, commit: commit.toLowerCase() };
  });
}
