import { resolve } from "node:path";

import { parseAgentAuthors } from "../agent-pr.js";
import type { AgentIntroducedFindings } from "../agent-pr.js";
import type { DiffResult } from "../diff.js";
import { parseRange } from "../diff.js";
import type { DataInfo, Finding, ScanResult, SuppressionRef, SuppressionState } from "../domain.js";
import { relativePosix } from "../paths.js";
import { required } from "../required.js";
import { diffWithBuiltIns } from "../scan-builtins.js";
import { runScanRequest } from "../scan-request.js";
import { agentAttribution } from "./agent-authors.js";
import { reviewFindings, reviewRange } from "./review.js";
import type { GitHubActionOptions, PackageScanSummary } from "./types.js";

type DiffSummary = Pick<DiffResult, "base" | "head" | "fixed" | "unchanged">;

/** What one Action run scanned, before the reports, annotations, and gates are produced. */
export interface ScanOutcome {
  result: ScanResult;
  expiredFailure: boolean;
  diff?: DiffSummary;
  packages?: PackageScanSummary[];
  agent?: AgentIntroducedFindings;
}

function prefixPath(prefix: string, path: string): string {
  if (!prefix || prefix === ".") return path;
  return `${prefix}/${path}`;
}

/** Relocate finding paths (and ids that embed them) from a package root to the workspace. */
function relocateFinding(finding: Finding, prefix: string): Finding {
  if (!prefix || prefix === ".") return finding;
  const oldPath = finding.location.path;
  const location = { ...finding.location, path: prefixPath(prefix, oldPath) };
  const idPrefix = `${finding.ruleId}:${oldPath}`;
  const id = finding.id.startsWith(idPrefix)
    ? `${finding.ruleId}:${location.path}${finding.id.slice(idPrefix.length)}`
    : finding.id;
  const usages = finding.usages?.map((usage) => ({
    ...usage,
    location: {
      ...usage.location,
      path: prefixPath(prefix, usage.location.path),
    },
  }));
  return { ...finding, id, location, ...(usages ? { usages } : {}) };
}

function relocateSuppressionRef(ref: SuppressionRef, prefix: string): SuppressionRef {
  if (!prefix || prefix === ".") return ref;
  return { ...ref, path: prefixPath(prefix, ref.path) };
}

function mergeSuppressions(states: readonly SuppressionState[]): SuppressionState | undefined {
  if (states.length === 0) return undefined;
  const first = required(states[0], "first suppression state");
  return {
    suppressed: states.reduce((sum, state) => sum + state.suppressed, 0),
    ...(first.today !== undefined ? { today: first.today } : {}),
    ...(first.warnWithinDays !== undefined ? { warnWithinDays: first.warnWithinDays } : {}),
    expiring: states.flatMap((state) => state.expiring),
    expired: states.flatMap((state) => state.expired),
  };
}

async function scanOneRoot(
  root: string,
  options: Pick<
    GitHubActionOptions,
    "sbom" | "baselinePath" | "today" | "baselineWarnDays" | "onExpired" | "minSupportDays"
  >,
): Promise<{ result: ScanResult; expiredFailure: boolean }> {
  return runScanRequest({
    root,
    ...(options.sbom === undefined ? {} : { sbom: options.sbom }),
    ...(options.baselinePath === undefined ? {} : { baselinePath: options.baselinePath }),
    ...(options.today === undefined ? {} : { today: options.today }),
    ...(options.baselineWarnDays === undefined ? {} : { baselineWarnDays: options.baselineWarnDays }),
    ...(options.onExpired === undefined ? {} : { onExpired: options.onExpired }),
    ...(options.minSupportDays === undefined ? {} : { minSupportDays: options.minSupportDays }),
  });
}

function diffAttribution(root: string, range: string, options: GitHubActionOptions) {
  const author = options.pullRequestAuthor;
  const sameRepositoryBranch = options.pullRequestSameRepositoryBranch;
  const verifiedCommitters = options.pullRequestVerifiedCommitters;
  if (author === undefined && sameRepositoryBranch === undefined && verifiedCommitters === undefined) return undefined;
  return agentAttribution(
    root,
    range,
    {
      ...(author ? { author } : {}),
      ...(sameRepositoryBranch ? { sameRepositoryBranch } : {}),
      ...(verifiedCommitters ? { verifiedCommitters } : {}),
    },
    parseAgentAuthors(options.agentAuthors),
  );
}

async function scanDiffMode(
  root: string,
  options: GitHubActionOptions,
  compare: typeof diffWithBuiltIns,
): Promise<ScanOutcome> {
  if (!options.diffRange) throw new Error("mode: diff needs the base and head refs of the pull request.");
  const requested = parseRange(options.diffRange);
  const refs = reviewRange(root, requested.base, requested.head);
  const compared = await compare(root, refs.range);
  const findings = await reviewFindings(root, refs, compared.introduced);
  // The diff gate judges only what the PR introduces, so no baseline and no min-support run over the whole backlog.
  const result: ScanResult = {
    schemaVersion: "offing.scan.v1",
    root,
    scannedAt: new Date().toISOString(),
    findings,
    diagnostics: [],
  };
  const diff = {
    base: requested.base,
    head: requested.head,
    fixed: compared.fixed,
    unchanged: compared.unchanged,
  };
  const attribution = findings.length > 0 ? diffAttribution(root, refs.range, options) : undefined;
  const agent = attribution
    ? { author: options.pullRequestAuthor ?? attribution.login, findings, attribution }
    : undefined;
  return { result, expiredFailure: false, diff, ...(agent ? { agent } : {}) };
}

async function scanPathsMode(
  root: string,
  options: GitHubActionOptions,
  paths: readonly string[],
): Promise<ScanOutcome> {
  const scannedAt = new Date().toISOString();
  const packageResults: PackageScanSummary[] = [];
  const allFindings: Finding[] = [];
  const allDiagnostics: string[] = [];
  const suppressionStates: SuppressionState[] = [];
  let expiredFailure = false;
  let data: DataInfo | undefined;

  for (const packageRoot of paths) {
    const absolute = resolve(packageRoot);
    const prefix = relativePosix(root, absolute) || ".";
    const scanned = await scanOneRoot(absolute, options);
    expiredFailure = expiredFailure || scanned.expiredFailure;
    const findings = scanned.result.findings.map((finding) => relocateFinding(finding, prefix));
    packageResults.push({ path: prefix, findings });
    allFindings.push(...findings);
    allDiagnostics.push(...scanned.result.diagnostics.map((line) => (prefix === "." ? line : `${prefix}: ${line}`)));
    if (scanned.result.suppressions) {
      suppressionStates.push({
        ...scanned.result.suppressions,
        expiring: scanned.result.suppressions.expiring.map((ref) => relocateSuppressionRef(ref, prefix)),
        expired: scanned.result.suppressions.expired.map((ref) => relocateSuppressionRef(ref, prefix)),
      });
    }
    data ??= scanned.result.data;
  }

  allFindings.sort((left, right) => left.id.localeCompare(right.id));
  const suppressions = mergeSuppressions(suppressionStates);
  const result: ScanResult = {
    schemaVersion: "offing.scan.v1",
    root,
    scannedAt,
    findings: allFindings,
    diagnostics: allDiagnostics,
    ...(data ? { data } : {}),
    ...(suppressions ? { suppressions } : {}),
  };
  return { result, expiredFailure, packages: packageResults };
}

/** Scans the checked-out tree, one package path, or a pull request range, depending on the inputs. */
export async function scanInMode(
  root: string,
  options: GitHubActionOptions,
  compare: typeof diffWithBuiltIns = diffWithBuiltIns,
): Promise<ScanOutcome> {
  if (options.sbom && (options.mode === "diff" || options.paths?.length)) {
    throw new Error("sbom requires scan mode and cannot be combined with paths.");
  }
  if (options.mode === "diff") return scanDiffMode(root, options, compare);
  if (options.paths && options.paths.length > 0) return scanPathsMode(root, options, options.paths);
  const scanned = await scanOneRoot(root, options);
  return { result: scanned.result, expiredFailure: scanned.expiredFailure };
}
