import type { CheckDependencyInput } from "./check-dependency.js";
import type { SnippetFinding } from "./check-snippet.js";
import { severityValues, type Severity } from "./domain.js";

export const GUARD_REQUEST_VERSION = "offing.agent-guard.request.v1" as const;
const GUARD_RESPONSE_VERSION = "offing.agent-guard.response.v1" as const;

export type AgentGuardGate = Severity | "none";
export type GuardSnippet = { path: string; content: string };

type RequestContext = {
  schemaVersion: typeof GUARD_REQUEST_VERSION;
  context?: { failOn?: AgentGuardGate };
};

export type AgentGuardRequest = RequestContext &
  ({ purl: string; snippet?: never } | { snippet: GuardSnippet; purl?: never; language?: string });

export interface AgentGuardResponse {
  schemaVersion: typeof GUARD_RESPONSE_VERSION;
  decision: "allow" | "warn" | "block";
  reason: string;
  replacement?: string;
  source?: string;
}

export function meetsGuardThreshold(severity: Severity | undefined, gate: AgentGuardGate): boolean {
  return severity !== undefined && gate !== "none" && severityValues.indexOf(severity) >= severityValues.indexOf(gate);
}

function reply(decision: AgentGuardResponse["decision"], reason: string): AgentGuardResponse {
  return { schemaVersion: GUARD_RESPONSE_VERSION, decision, reason };
}

function wireText(text: string, max: number): string {
  const clean = Buffer.from(text.replace(/[\x00-\x1f\x7f]+/g, " ").trim(), "utf8").toString("utf8");
  return clean.length > max
    ? Array.from(clean)
        .slice(0, max - 1)
        .join("") + "…"
    : clean;
}

function describeFinding(
  finding: { title: string; severity: Severity; replacement?: string | null; sources: readonly { url: string }[] },
  gate: AgentGuardGate,
): AgentGuardResponse {
  const blocked = meetsGuardThreshold(finding.severity, gate);
  const policy = gate === "none" ? "blocking is disabled" : `blocking threshold: ${gate}`;
  const source = finding.sources.find(
    (entry) => entry.url.length <= 1000 && /^https?:\/\/[^/\s]+[^\s]*$/.test(entry.url),
  );
  const replacement = finding.replacement ? wireText(finding.replacement, 350) : "";
  return {
    ...reply(blocked ? "block" : "warn", `${wireText(finding.title, 300)} (${finding.severity}; ${policy}).`),
    ...(replacement ? { replacement } : {}),
    ...(source ? { source: source.url } : {}),
  };
}

export async function assessGuardDependency(input: CheckDependencyInput, gate: AgentGuardGate = "high") {
  const { checkDependency } = await import("./check-dependency.js");
  const check = await checkDependency(input);
  const finding = check.findings[0];
  let response: AgentGuardResponse;
  switch (check.status) {
    case "affected":
      if (finding === undefined) throw new Error("An affected dependency check must have a finding.");
      response = describeFinding(finding, gate);
      break;
    case "version-dependent":
      response = reply("warn", "Lifecycle rules apply to some versions. Check again with the intended version.");
      break;
    case "no-data":
      response = reply("warn", "No lifecycle data covers this package.");
      break;
    case "not-affected":
      response = reply("allow", "No lifecycle rule applies to the checked version.");
      break;
  }
  return { check, response };
}

function mostSevere(findings: readonly SnippetFinding[]): SnippetFinding | undefined {
  return findings.reduce<SnippetFinding | undefined>((highest, finding) => {
    if (highest === undefined || severityValues.indexOf(finding.severity) > severityValues.indexOf(highest.severity)) {
      return finding;
    }
    return highest;
  }, undefined);
}

export async function assessGuardSnippet(input: GuardSnippet, gate: AgentGuardGate = "high") {
  const { checkSnippet } = await import("./check-snippet.js");
  const check = await checkSnippet(input);
  const finding = mostSevere(check.findings);
  return { check, response: finding === undefined ? reply("allow", check.message) : describeFinding(finding, gate) };
}

export async function checkAgentGuard(request: AgentGuardRequest): Promise<AgentGuardResponse> {
  const gate = request.context?.failOn;
  const result =
    request.purl === undefined
      ? await assessGuardSnippet(request.snippet, gate)
      : await assessGuardDependency({ purl: request.purl }, gate);
  return result.response;
}
