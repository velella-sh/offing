import type { Finding } from "../domain.js";
import { locationText, singleLine } from "../forecast-core.js";
import { renderSarif } from "../reporters/sarif.js";
import type { GateDecision, GateReason, GateReport } from "./decision.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timing(reason: GateReason): string {
  if (reason.code === "no-data") return "no dated lifecycle evidence";
  return `${reason.ruleId ?? "Lifecycle deadline"} ends ${reason.deadline} (${reason.daysLeft} days left)`;
}

function reasonText(reason: GateReason): string {
  const place = reason.location ? ` at ${locationText(reason.location)}` : "";
  const exception = reason.exception
    ? ` · ${reason.outcome === "excepted" ? "Exception through" : "Exception expired on"} ${reason.exception.expires}: ${reason.exception.reason}`
    : "";
  return singleLine(`${reason.component}${place}: ${timing(reason)}${exception}`);
}

export function renderDecision(decision: GateDecision): string {
  return [
    `${decision.verdict.toUpperCase()} ${singleLine(decision.input.target)} (${decision.input.kind})`,
    ...decision.reasons.map((reason) => `  [${reason.outcome}] ${reasonText(reason)}`),
    ...(decision.reasons.length === 0 ? ["  No blocking lifecycle deadline or reported evidence gap."] : []),
  ].join("\n");
}

function gateFinding(reason: GateReason, root: string, index: number): Finding {
  const ruleId = reason.ruleId ?? "release-gate.no-data";
  const location = reason.location ?? { path: "." };
  return {
    id: `${ruleId}:${root}:${index}`,
    ruleId,
    title: reason.code === "lifecycle" ? "Lifecycle deadline" : "Missing lifecycle evidence",
    summary: reasonText(reason),
    severity: reason.outcome === "block" ? "high" : "medium",
    sources: (reason.sources ?? []).map((url) => ({ title: "Lifecycle evidence", url })),
    detector: "release-gate",
    confidence: "exact",
    location: { ...location, path: location.path.split("/").map(encodeURIComponent).join("/") },
    ...(reason.deadline ? { deadline: reason.deadline } : {}),
  };
}

function renderGateSarif(report: GateReport): string {
  const root = report.decisions[0]?.input.target ?? ".";
  const findings = report.decisions.flatMap(({ input, reasons }) =>
    reasons
      .filter(({ outcome }) => outcome !== "excepted")
      .map((reason, index) => gateFinding(reason, input.target, index)),
  );
  const sarif: unknown = JSON.parse(
    renderSarif({
      schemaVersion: "offing.scan.v1",
      root,
      scannedAt: report.asOf,
      findings,
      diagnostics: [],
    }),
  );
  if (!isRecord(sarif) || !Array.isArray(sarif.runs)) throw new Error("Expected SARIF runs.");
  for (const run of sarif.runs) {
    if (!isRecord(run)) throw new Error("Expected a SARIF run.");
    run.properties = { offingReleaseGate: report };
  }
  return JSON.stringify(sarif, null, 2);
}

export function renderGate(report: GateReport, format: "text" | "json" | "sarif"): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  if (format === "sarif") return renderGateSarif(report);
  const subject = report.releaseRef ? `Rollback readiness for ${singleLine(report.releaseRef)}` : "Release gate";
  return [
    `${subject} as of ${report.asOf} UTC, support through ${report.supportUntil} (inclusive)`,
    ...report.decisions.map(renderDecision),
  ].join("\n");
}
