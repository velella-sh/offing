import { applyMinSupport, parseMinSupportDays } from "@velella/ebb/min-support";
import { daysBetween } from "./baseline.js";
import { matchesIgnorePattern } from "./config.js";
import type {
  Finding,
  LifecyclePolicy,
  PolicyException,
  PolicyRule,
  PolicyScope,
  PolicyViolation,
  ScanResult,
  Severity,
} from "./domain.js";
import { severityValues } from "./domain.js";
import { scanSelectorMatches } from "./engine/resolve.js";

export type SeverityGate = Severity | "none";

export function findingsAtSeverity(findings: readonly Finding[], gate: SeverityGate): Finding[] {
  if (gate === "none") return [];
  const rank = severityValues.indexOf(gate);
  return findings.filter((finding) => severityValues.indexOf(finding.severity) >= rank);
}

export function supportWarning(result: ScanResult, days: number | undefined, today: string): ScanResult {
  return days === undefined ? result : applyMinSupport(result, days, today);
}

export function parseLookahead(input: string): number | undefined {
  const match = /^(\d+)([dwy])$/.exec(input);
  if (!match) return undefined;
  const days = Number(match[1]) * (match[2] === "w" ? 7 : match[2] === "y" ? 365 : 1);
  return parseMinSupportDays(String(days));
}

function matchesScope(scope: PolicyScope, finding: Finding): boolean {
  return (
    (scope.ecosystem === undefined || scanSelectorMatches(scope.ecosystem, finding.detector, finding.ruleId)) &&
    (scope.path === undefined || matchesIgnorePattern([scope.path], finding.location.path))
  );
}

/** Expired matches take precedence over active matches, as in the scan policy gate. */
export function matchingPolicyException(
  exceptions: readonly PolicyException[],
  detector: string,
  ruleId: string,
  path: string | undefined,
  today: string,
): PolicyException | undefined {
  const matches = exceptions.filter(
    (scope) =>
      (scope.ecosystem === undefined || scanSelectorMatches(scope.ecosystem, detector, ruleId)) &&
      (scope.path === undefined || (path !== undefined && matchesIgnorePattern([scope.path], path))),
  );
  return matches.find((match) => match.expires < today) ?? matches[0];
}

function matchesDeadline(rule: PolicyRule, deadline: string | undefined, today: string): boolean {
  const window = rule["days-left"];
  const ended = rule["after-eol"];
  if (window === undefined && ended === undefined) return true;
  if (deadline === undefined) return false;
  return (
    (window === undefined || daysBetween(today, deadline) <= window) &&
    (ended === undefined || ended === deadline <= today)
  );
}

function matchesRule(rule: PolicyRule, finding: Finding, today: string): boolean {
  return (
    matchesScope(rule, finding) &&
    matchesDeadline(rule, finding.deadline, today) &&
    (rule.severity === undefined || severityValues.indexOf(finding.severity) >= severityValues.indexOf(rule.severity))
  );
}

function policyViolation(
  rule: PolicyRule,
  finding: Finding,
  exceptions: readonly PolicyException[],
  today: string,
): PolicyViolation[] {
  if (!matchesRule(rule, finding, today)) return [];
  const match = matchingPolicyException(exceptions, finding.detector, finding.ruleId, finding.location.path, today);
  if (match && match.expires >= today) return [];
  const expired = match;
  return [
    {
      rule: rule.id,
      findingId: finding.id,
      path: finding.location.path,
      ...(expired ? { expiredException: { expires: expired.expires, reason: expired.reason } } : {}),
    },
  ];
}

export function applyPolicy(
  result: ScanResult,
  policy: LifecyclePolicy | undefined,
  today: string,
  lookahead?: number,
): ScanResult {
  if (policy === undefined && lookahead === undefined) return result;
  const rules = [...(policy?.rules ?? [])];
  if (lookahead !== undefined) rules.push({ id: "--lookahead", "days-left": lookahead });
  const violations = rules.flatMap((rule) =>
    result.findings.flatMap((finding) => policyViolation(rule, finding, policy?.exceptions ?? [], today)),
  );
  return { ...result, policy: { violations } };
}

export function policyViolationText(violation: PolicyViolation): string {
  const expired = violation.expiredException;
  return (
    `Policy rule ${violation.rule} failed for ${violation.path} (${violation.findingId}).` +
    (expired ? ` Exception expired on ${expired.expires}: ${expired.reason}.` : "")
  );
}
