import { addDays } from "@velella/ebb/forecast";
import { isIsoDate, type LifecycleEvent } from "@velella/ebb/registry";

import { daysBetween } from "../baseline.js";
import type { PolicyException, SourceLocation } from "../domain.js";
import { OffingError } from "../offing-error.js";
import { matchingPolicyException } from "../policy.js";

export const DEFAULT_WITHIN_DAYS = 30;
export type NoDataMode = "fail" | "warn" | "ignore";

export interface GateWindow {
  asOf: string;
  supportUntil: string;
  noData: NoDataMode;
}

export interface GateInput {
  kind: "path" | "git-ref" | "sbom" | "attestation";
  target: string;
}

export interface LifecycleObservation {
  component: string;
  detector: string;
  location?: SourceLocation;
  rule?: { id: string; event: LifecycleEvent; date?: string; sources: readonly string[] };
}

export interface GateReason {
  code: "lifecycle" | "no-data";
  outcome: "block" | "warn" | "excepted";
  component: string;
  location?: SourceLocation;
  ruleId?: string;
  deadline?: string;
  daysLeft?: number;
  sources?: readonly string[];
  exception?: Pick<PolicyException, "reason" | "expires">;
}

export interface GateDecision {
  input: GateInput;
  verdict: "pass" | "warn" | "block";
  reasons: GateReason[];
}

export interface GateReport extends GateWindow {
  schemaVersion: "offing.release-gate.v1";
  releaseRef?: string;
  decisions: GateDecision[];
}

export function parseGateDays(value: string): number {
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days)) {
    throw new OffingError("invalid-argument", "--within-days must be a non-negative safe integer.");
  }
  return days;
}

export function gateWindow(
  asOf: string,
  withinDays = DEFAULT_WITHIN_DAYS,
  supportUntil?: string,
  noData: string = "warn",
): GateWindow {
  if (!isIsoDate(asOf)) throw new OffingError("invalid-date", "Expected --today to be a UTC date (YYYY-MM-DD).");
  if (noData !== "warn" && noData !== "fail" && noData !== "ignore") {
    throw new OffingError("invalid-argument", "--no-data must be fail, warn or ignore.");
  }
  if (
    supportUntil === undefined &&
    (!Number.isSafeInteger(withinDays) || withinDays < 0 || withinDays > daysBetween(asOf, "9999-12-31"))
  ) {
    throw new OffingError("invalid-argument", "The support window must end on or before 9999-12-31.");
  }
  const until = supportUntil ?? addDays(asOf, withinDays);
  if (!isIsoDate(until) || until < asOf) {
    throw new OffingError("invalid-date", "--support-until must be a UTC date on or after --today.");
  }
  return { asOf, supportUntil: until, noData };
}

function reasonFor(
  observation: LifecycleObservation,
  window: GateWindow,
  exceptions: readonly PolicyException[],
): GateReason[] {
  const { component, detector, rule, location } = observation;
  const common = { component, ...(location ? { location } : {}) };
  if (rule?.event === "deprecated") return [];
  if (!rule?.date) {
    if (window.noData === "ignore") return [];
    return [
      {
        ...common,
        code: "no-data",
        outcome: window.noData === "fail" ? "block" : "warn",
        ...(rule ? { ruleId: rule.id, sources: rule.sources } : {}),
      },
    ];
  }
  if (rule.date > window.supportUntil) return [];
  const match = matchingPolicyException(exceptions, detector, rule.id, location?.path, window.asOf);
  return [
    {
      ...common,
      code: "lifecycle",
      outcome: match && match.expires >= window.asOf ? "excepted" : "block",
      ruleId: rule.id,
      deadline: rule.date,
      daysLeft: daysBetween(window.asOf, rule.date),
      sources: rule.sources,
      ...(match ? { exception: { reason: match.reason, expires: match.expires } } : {}),
    },
  ];
}

export function decideRelease(
  input: GateInput,
  observations: readonly LifecycleObservation[],
  window: GateWindow,
  exceptions: readonly PolicyException[] = [],
): GateDecision {
  const reasons = observations.flatMap((observation) => reasonFor(observation, window, exceptions));
  const verdict = reasons.some(({ outcome }) => outcome === "block")
    ? "block"
    : reasons.some(({ outcome }) => outcome === "warn")
      ? "warn"
      : "pass";
  return { input, verdict, reasons };
}

export function gateReport(window: GateWindow, decisions: GateDecision[], releaseRef?: string): GateReport {
  return { schemaVersion: "offing.release-gate.v1", ...window, ...(releaseRef ? { releaseRef } : {}), decisions };
}
