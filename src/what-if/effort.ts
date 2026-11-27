import type { Finding, ScanResult } from "../domain.js";
import { runtimePinsFixer } from "../fix/index.js";
import { runtimeTarget } from "../fix/runtime-pins.js";
import type { UpgradeIssue, UpgradeTarget } from "../upgrade/types.js";
import { pinDiffersFromTarget } from "../upgrade/target-lifecycle.js";
import { pinFindings, type projectPins } from "./pins.js";

export interface Effort {
  kind: "automatic" | "assisted" | "manual";
  reason: string;
  evidence: string;
}

type Pin = ReturnType<typeof projectPins>[number];

function assisted(finding: Finding | undefined, fallback: string): Effort {
  if (finding?.migration?.steps.length) {
    return {
      kind: "assisted",
      reason:
        "A finding-specific migration packet can guide an agent. The requested change has no confirmed deterministic edit.",
      evidence: finding.id,
    };
  }
  return {
    kind: "manual",
    reason: "No matching deterministic edit or finding-specific migration guidance was observed.",
    evidence: fallback,
  };
}

async function automaticPin(scan: ScanResult, pin: Pin, target: UpgradeTarget, finding: Finding): Promise<boolean> {
  const runtime = target.runtime === "nodejs" ? "node" : target.runtime;
  if (runtime !== "node" && runtime !== "python") return false;
  const suggested = await runtimeTarget(scan)(runtime, pin.normalized);
  // A generic recommendation is not evidence of a deterministic edit to the requested precision.
  if (
    !suggested ||
    pinDiffersFromTarget({ ...pin, normalized: suggested.split(".").concat("0", "0").slice(0, 3).join(".") }, target) ||
    suggested.split(".").length < target.version.split(".").length
  )
    return false;
  let refused = false;
  const patches = await runtimePinsFixer.plan({ ...scan, findings: [finding] }, () => {
    refused = true;
  });
  return !refused && patches.some((patch) => patch.path === pin.path);
}

export async function pinEffort(scan: ScanResult, pin: Pin, target: UpgradeTarget): Promise<Effort> {
  const fallback = `${pin.path}:${pin.line}`;
  if (pin.change === "unresolved") {
    return {
      kind: "manual",
      reason: "Changing this declaration requires resolving a range, image variant, digest or interpolation.",
      evidence: fallback,
    };
  }
  const findings = pinFindings(pin, target, scan.findings);
  for (const finding of findings) {
    if (pin.field !== "FROM" && (await automaticPin(scan, pin, target, finding))) {
      return {
        kind: "automatic",
        reason: "The runtime-pins codemod proposes this exact release line.",
        evidence: finding.id,
      };
    }
  }
  return assisted(
    findings.find(({ migration }) => migration?.steps.length),
    fallback,
  );
}

export function issueEffort(scan: ScanResult, issue: UpgradeIssue): Effort {
  const finding = scan.findings.find(
    ({ ruleId, location }) =>
      issue.evidence.kind === "rule" &&
      issue.evidence.value === ruleId &&
      location.path === issue.path &&
      location.line === issue.line,
  );
  return assisted(finding, issue.evidence.value);
}
