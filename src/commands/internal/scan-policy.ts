import { loadConfig } from "../../config.js";
import type { ScanResult } from "../../domain.js";
import { severityValues } from "../../domain.js";
import { builtInDetectors } from "../../detectors/index.js";
import { applyScanSelection, findRepositories, renderMultiScanText, scanProjects } from "../../engine/index.js";
import { applyPolicy, findingsAtSeverity, parseLookahead, policyViolationText } from "../../policy.js";
import type { Gated } from "../runtime.js";
import type { CommandContext } from "../types.js";

export function scanPolicyDay(state: Gated): string {
  return state.optionValue("--as-of") ?? state.optionValue("--today") ?? new Date().toISOString().slice(0, 10);
}

export function requestedLookahead(state: Gated): number | undefined {
  const option = state.optionValue("--lookahead");
  return option === undefined ? undefined : parseLookahead(option);
}

export function checkLookahead(state: Gated, ctx: CommandContext): number | undefined {
  if (!state.args.includes("--lookahead")) return undefined;
  if (state.optionValues("--lookahead").length !== 1 || requestedLookahead(state) === undefined) {
    return ctx.fail("usage", "--lookahead requires one duration, such as 90d, 2w or 1y, up to 3650 days.");
  }
  return undefined;
}

/** `--fail-on`: the policy gate on the scan's own severity floor. */
export function failOnSeverity(state: Gated, result: ScanResult, ctx: CommandContext): number {
  if (state.command !== "scan") return 0;
  const scanGate = state.optionValue("--fail-on") ?? state.config?.failOn ?? "none";
  const severity = severityValues.find((value) => value === scanGate);
  if (severity === undefined) return 0;
  const blocking = findingsAtSeverity(result.findings, severity);
  if (blocking.length === 0) return 0;
  return ctx.fail(
    "policy",
    `${blocking.length} finding${blocking.length === 1 ? "" : "s"} at ${scanGate} or above (--fail-on ${scanGate}).`,
  );
}

/** Several paths, or every repository under `--all`, scanned and printed as one document. */
export async function multiScanPhase(
  state: Gated,
  allDirectory: string | undefined,
  ctx: CommandContext,
): Promise<number> {
  if (state.format !== undefined && state.format !== "text" && state.format !== "json") {
    return ctx.fail("usage", "Scanning several paths supports --json and --format text|json only.");
  }
  if (state.args.includes("--baseline") || state.args.includes("--write-status")) {
    return ctx.fail("usage", "--baseline and --write-status are not available when scanning several paths.");
  }
  let found: string[] = [];
  if (allDirectory !== undefined) {
    try {
      found = await findRepositories(allDirectory);
    } catch (error) {
      return ctx.fail(
        "usage",
        `Cannot read ${allDirectory}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const paths = [...state.positional, ...found];
  if (paths.length === 0) return ctx.fail("usage", `No Git repositories found in ${allDirectory}.`);
  const multi = await scanProjects(paths, builtInDetectors, { noCache: state.noCache });
  const today = scanPolicyDay(state);
  const lookahead = requestedLookahead(state);
  multi.projects = await Promise.all(
    multi.projects.map(async (project) => {
      const selected = state.selection ? applyScanSelection(project.result, state.selection) : project.result;
      const config = await loadConfig(project.result.root);
      const result = applyPolicy(selected, config?.policy, today, lookahead);
      return { ...project, findings: result.findings.length, result };
    }),
  );
  multi.total = {
    projects: multi.projects.length,
    findings: multi.projects.reduce((sum, project) => sum + project.findings, 0),
  };
  process.stdout.write(`${state.json ? JSON.stringify(multi, null, 2) : renderMultiScanText(multi)}\n`);
  const first = multi.projects.flatMap((project) => project.result.policy?.violations ?? [])[0];
  return first ? ctx.fail("policy", policyViolationText(first)) : 0;
}
