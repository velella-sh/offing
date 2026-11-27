import type { runReplayLoop as ReplayLoop } from "../autopilot/replay.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderBadgeSvg } from "../badge.js";
import type { Finding, ScanResult } from "../domain.js";
import { renderJson, renderSarif } from "../reporters.js";
import { loadConfig } from "../config.js";
import { resolveLifecyclePolicy } from "../fleet-policy/load.js";
import { applyPolicy, findingsAtSeverity } from "../policy.js";
import { changedLines, planFixSuggestions, selectChangedAnnotations } from "./diff.js";
import { parseAnnotations, parseGate } from "./inputs.js";
import { annotationFor, renderBadge } from "./render.js";
import { runReleaseGate } from "./release-gate.js";
import { scanInMode } from "./scan.js";
import type { AnnotationScope, GitHubActionOptions, GitHubActionOutcome, LineRange } from "./types.js";

async function writeReports(
  options: GitHubActionOptions,
  result: ScanResult,
): Promise<{ reportPath: string; sarifPath?: string }> {
  const reportPath = resolve(options.reportPath);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${renderJson(result)}\n`, "utf8");
  if (!options.sarifPath) return { reportPath };
  const sarifPath = resolve(options.sarifPath);
  await mkdir(dirname(sarifPath), { recursive: true });
  await writeFile(sarifPath, `${renderSarif(result)}\n`, "utf8");
  return { reportPath, sarifPath };
}

async function writeBadge(
  options: GitHubActionOptions,
  result: ScanResult,
  expiredFailure: boolean,
): Promise<{ badgePath?: string; badgeSvgPath?: string }> {
  if (!options.badgePath) return {};
  const badgePath = resolve(options.badgePath);
  const badgeSvgPath = badgePath.replace(/\.json$/, "") + ".svg";
  await mkdir(dirname(badgePath), { recursive: true });
  await writeFile(badgePath, `${renderBadge(result, expiredFailure)}\n`, "utf8");
  await writeFile(badgeSvgPath, `${renderBadgeSvg(result, expiredFailure)}\n`, "utf8");
  return { badgePath, badgeSvgPath };
}

function selectAnnotations(
  findings: readonly Finding[],
  scope: AnnotationScope,
  changed: ReadonlyMap<string, readonly LineRange[]> | undefined,
): { annotated: readonly Finding[]; unannotated: number } {
  if (scope === "none") return { annotated: [], unannotated: 0 };
  if (scope === "changed" && changed) {
    const selected = selectChangedAnnotations(findings, changed);
    return { annotated: selected.annotated, unannotated: selected.unannotated.length };
  }
  return { annotated: findings, unannotated: 0 };
}

async function planAnnotations(
  root: string,
  options: GitHubActionOptions,
  result: ScanResult,
): Promise<{
  annotations: GitHubActionOutcome["annotations"];
  unannotated: number;
  suggestions: GitHubActionOutcome["suggestions"];
}> {
  const scope = parseAnnotations(options.annotations, options.mode === "diff" ? "diff" : "scan");
  const diffRange = options.mode === "diff" ? options.diffRange : undefined;
  const changed =
    diffRange !== undefined && (scope === "changed" || options.suggestFixes === true)
      ? changedLines(root, diffRange)
      : undefined;
  const selected = selectAnnotations(result.findings, scope, changed);
  const suggestions = options.suggestFixes === true && changed ? await planFixSuggestions(result, changed) : [];
  return { annotations: selected.annotated.map(annotationFor), unannotated: selected.unannotated, suggestions };
}

/** Scans, writes the requested reports, evaluates the gates, and reports whether the job should fail. */
export async function runGitHubAction(options: GitHubActionOptions): Promise<GitHubActionOutcome> {
  const root = resolve(options.root);
  const gate = parseGate(options.failOnSeverity);
  const config = await loadConfig(root);
  const policy = await resolveLifecyclePolicy({
    root,
    config,
    reference: options.policy,
    requireUnderRoot: true,
    today: options.today ?? new Date().toISOString().slice(0, 10),
  });
  const scanned = await scanInMode(root, options);
  const { expiredFailure, diff, packages, agent } = scanned;
  const today = options.today ?? scanned.result.scannedAt.slice(0, 10);
  const releaseGate = await runReleaseGate(root, options, policy, today);
  const result = applyPolicy(scanned.result, policy, today);
  const { reportPath, sarifPath } = await writeReports(options, result);

  const gateFailed = findingsAtSeverity(result.findings, gate).length > 0;
  const policyFailed = (result.policy?.violations.length ?? 0) > 0;
  const badge = await writeBadge(options, result, expiredFailure);
  const planned = await planAnnotations(root, options, result);

  return {
    result,
    reportPath,
    ...(badge.badgePath ? { badgePath: badge.badgePath } : {}),
    ...(badge.badgeSvgPath ? { badgeSvgPath: badge.badgeSvgPath } : {}),
    ...(sarifPath ? { sarifPath } : {}),
    annotations: planned.annotations,
    unannotated: planned.unannotated,
    suggestions: planned.suggestions,
    failed: expiredFailure || gateFailed || policyFailed || releaseGate?.verdict === "block",
    ...(releaseGate ? { releaseGate } : {}),
    gateFailed,
    gate,
    expiredFailure,
    ...(diff ? { diff } : {}),
    ...(packages ? { packages } : {}),
    ...(agent ? { agent } : {}),
  };
}

async function autopilotDispatchWorkspace(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Offing Autopilot requires an explicit workflow_dispatch on the default branch.");
  const { readJsonFile, record } = await import("../agent-drivers/result.js");
  const event = env.GITHUB_EVENT_PATH && record(await readJsonFile(env.GITHUB_EVENT_PATH, 1024 * 1024));
  const repository = event ? record(event.repository) : undefined;
  const branch = repository?.default_branch;
  if (typeof branch !== "string" || !branch || repository?.fork !== false || env.GITHUB_REF !== `refs/heads/${branch}`)
    throw new Error("Offing Autopilot requires the default branch of a non-fork repository.");
  if (!env.GITHUB_WORKSPACE) throw new Error("Offing Autopilot requires a checked-out GITHUB_WORKSPACE.");
  return env.GITHUB_WORKSPACE;
}

/** Opt-in Action driver entry. Public Autopilot Action inputs and PR publishing are wired separately. */
export async function runActionAutopilot(
  env: NodeJS.ProcessEnv,
  runTests?: Parameters<typeof ReplayLoop>[4],
): Promise<boolean> {
  const key = env.OFFING_ACTION_AUTOPILOT_KEY;
  delete env.OFFING_ACTION_AUTOPILOT_KEY;
  if (env.OFFING_ACTION_AUTOPILOT !== "true") return false;
  const workspace = await autopilotDispatchWorkspace(env);
  const name = env.OFFING_ACTION_AUTOPILOT_SECRET_NAME;
  if (!name || !/^[A-Z_][A-Z0-9_]{0,99}$/.test(name))
    throw new Error("Set OFFING_ACTION_AUTOPILOT_SECRET_NAME to the workflow's selected secret name.");
  if (!key?.trim())
    throw new Error(`Offing Autopilot needs the selected secret ${name}. Wire it to OFFING_ACTION_AUTOPILOT_KEY.`);
  const { runReplayLoop } = await import("../autopilot/replay.js");
  const { startRun } = await import("../autopilot/state.js");
  const { withAutopilotWorktree } = await import("../autopilot/worktree.js");
  const run = startRun("prepare");
  const location = await withAutopilotWorktree(workspace, run, async (tree, checkout) => {
    await runReplayLoop(
      tree,
      checkout,
      run,
      {
        file: "",
        selection: {},
        allowedBaseline: new Set<string>(),
        started: performance.now(),
        claude: { key, path: env.PATH },
      },
      runTests,
    );
  });
  if (run.stopReason === "install-pinned-claude-code") {
    throw new Error(
      "Install the pinned Claude Code version from the Agent drivers guide before running Offing Autopilot.",
    );
  }
  if (run.state !== "done") throw new Error(`Offing Autopilot stopped (${run.stopReason ?? "unknown"}).`);
  console.log(`Offing Autopilot verified in ${location.branch}.`);
  return true;
}
