import type { LifecyclePolicy } from "../domain.js";
import { decideRelease, gateWindow, parseGateDays, type GateDecision } from "../release-gate/decision.js";
import { repositoryObservations, sbomObservations } from "../release-gate/inputs.js";
import { renderDecision } from "../release-gate/render.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import type { GitHubActionOptions } from "./types.js";

export function readReleaseGateDays(value: string | undefined): number | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  try {
    return parseGateDays(input);
  } catch {
    throw new Error("release-gate-days must be a non-negative safe integer.");
  }
}

export async function runReleaseGate(
  root: string,
  options: GitHubActionOptions,
  policy: LifecyclePolicy | undefined,
  today: string,
): Promise<GateDecision | undefined> {
  if (options.releaseGateDays === undefined) return undefined;
  if (options.mode === "diff" || options.paths?.length) {
    throw new Error("release-gate-days requires one root or SBOM in scan mode.");
  }
  const window = gateWindow(today, options.releaseGateDays);
  const observations = options.sbom
    ? await sbomObservations(options.sbom, root, true)
    : await repositoryObservations(await scanWithBuiltIns(root));
  return decideRelease(
    { kind: options.sbom ? "sbom" : "path", target: options.sbom ?? "." },
    observations,
    window,
    policy?.exceptions,
  );
}

export function releaseGateSummary(decision: GateDecision | undefined): string {
  if (!decision) return "";
  const shown = { ...decision, reasons: decision.reasons.slice(0, 20) };
  const body = renderDecision(shown)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  const remaining = decision.reasons.length - shown.reasons.length;
  return `\n### Release gate\n\n${body}\n${remaining ? `\n${remaining} additional observations.\n` : ""}`;
}
