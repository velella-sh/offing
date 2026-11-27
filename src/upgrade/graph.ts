import { compare } from "../reporters/shared.js";
import type { UpgradeBlocker, UpgradeGraph, UpgradeIssue, UpgradeReport } from "./types.js";

function blocker(issue: UpgradeIssue): UpgradeBlocker {
  return {
    subject: issue.subject,
    path: issue.path,
    // The currently published Ebb data has no first-supporting package release relation.
    firstSupported: "unknown",
    ...(issue.chain === undefined ? {} : { chain: issue.chain }),
  };
}

function compareBlockers(left: UpgradeBlocker, right: UpgradeBlocker): number {
  return (
    compare(left.subject, right.subject) ||
    compare(left.path, right.path) ||
    compare(left.chain?.join("\0") ?? "", right.chain?.join("\0") ?? "")
  );
}

/** Group only confirmed blockers. A blocker without a recorded chain stays ungrouped. */
export function buildBlockerGraph(report: UpgradeReport): UpgradeGraph {
  const grouped = new Map<string, UpgradeBlocker[]>();
  const ungrouped: UpgradeBlocker[] = [];
  const blockers = report.issues
    .filter((issue) => issue.level === "blocker")
    .map(blocker)
    .sort(compareBlockers);
  for (const entry of blockers) {
    const root = entry.chain?.[0];
    if (root === undefined) {
      ungrouped.push(entry);
      continue;
    }
    const group = grouped.get(root) ?? [];
    group.push(entry);
    grouped.set(root, group);
  }
  const roots = [...grouped].map(([dependency, entries]) => ({
    dependency,
    unlocks: entries.length,
    blockers: entries,
  }));
  roots.sort((left, right) => right.unlocks - left.unlocks || compare(left.dependency, right.dependency));
  return { total: blockers.length, roots, ungrouped };
}
