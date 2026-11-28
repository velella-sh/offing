import { formatPurl } from "@velella/ebb/purl";

import { compare } from "../reporters/shared.js";
import type { UpgradeBlocker, UpgradeGraph, UpgradeIssue, UpgradeReport, UpgradeTarget } from "./types.js";

type FirstSupporting = (purl: string, runtimePurl: string, runtimeVersion: string) => unknown;

const packageTypes = new Map([
  ["npm-lock", "npm"],
  ["pnpm-lock", "npm"],
  ["poetry-lock", "pypi"],
  ["uv-pdm-lock", "pypi"],
  ["composer-lock", "composer"],
  ["go-modules", "golang"],
]);

const runtimeNames = new Map([
  ["go", "golang"],
  ["node", "nodejs"],
  ["py", "python"],
]);

async function importCompatibility(specifier: string): Promise<unknown> {
  let path: string;
  try {
    path = import.meta.resolve(specifier);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      return undefined;
    }
    throw error;
  }
  try {
    return await import(path);
  } catch (error) {
    // Ebb 0.2.0 resolves the subpath through its wildcard export, but has no compatibility module.
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND" &&
      "url" in error &&
      error.url === path
    ) {
      return undefined;
    }
    throw error;
  }
}

function isFirstSupporting(value: unknown): value is FirstSupporting {
  return typeof value === "function";
}

async function loadFirstSupporting(specifier: string): Promise<FirstSupporting | undefined> {
  const compat = await importCompatibility(specifier);
  if (typeof compat === "object" && compat !== null && "firstSupporting" in compat) {
    const { firstSupporting } = compat;
    if (isFirstSupporting(firstSupporting)) return firstSupporting;
  }
  return undefined;
}

function dependencyPurl(issue: UpgradeIssue): string | undefined {
  const type = packageTypes.get(issue.analyzer);
  if (type === undefined || issue.evidence.kind !== "lockfile") return undefined;
  const at = issue.subject.lastIndexOf("@");
  const identity = at > 0 ? issue.subject.slice(0, at) : issue.subject;
  const slash = identity.lastIndexOf("/");
  if ((type === "composer" || type === "golang") && slash < 1) return undefined;
  if (type === "pypi" && (slash !== -1 || issue.subject === "python")) return undefined;
  const name = identity.slice(slash + 1);
  if (!name) return undefined;
  const namespace = slash < 1 ? undefined : identity.slice(0, slash);
  return formatPurl({ type, name, ...(namespace === undefined ? {} : { namespace }) });
}

async function firstSupportingRelease(
  issue: UpgradeIssue,
  target: UpgradeTarget,
  firstSupporting: FirstSupporting | undefined,
): Promise<string> {
  if (firstSupporting === undefined) return "unknown";
  const purl = dependencyPurl(issue);
  if (purl === undefined) return "unknown";
  const runtime = runtimeNames.get(target.runtime) ?? target.runtime;
  const answer = await firstSupporting(purl, `pkg:generic/${runtime}`, target.version);
  const version = typeof answer === "object" && answer !== null && "version" in answer ? answer.version : answer;
  return typeof version === "string" && /^v?\d[^\s]*$/u.test(version) ? version : "unknown";
}

function blocker(issue: UpgradeIssue, firstSupported: string): UpgradeBlocker {
  return {
    subject: issue.subject,
    path: issue.path,
    firstSupported,
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
export async function buildBlockerGraph(
  report: UpgradeReport,
  compatibilityModule = "@velella/ebb/compat",
): Promise<UpgradeGraph> {
  const grouped = new Map<string, UpgradeBlocker[]>();
  const ungrouped: UpgradeBlocker[] = [];
  const issues = report.issues.filter((issue) => issue.level === "blocker");
  const support = issues.length === 0 ? undefined : await loadFirstSupporting(compatibilityModule);
  const blockers = await Promise.all(
    issues.map(async (issue) => blocker(issue, await firstSupportingRelease(issue, report.target, support))),
  );
  blockers.sort(compareBlockers);
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
