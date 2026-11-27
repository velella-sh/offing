import type { RegistryV2Rule } from "@velella/ebb/registry";
import { parseVersLenient, versionScheme } from "@velella/ebb/vers";

import { severityValues, type ScanResult, type Severity, type SourceUsageContract } from "./domain.js";
import { estimateTokens, serialized } from "./mcp/limit.js";
import { RUNTIME_RULE_PREFIXES, type RuntimePin } from "./upgrade/target-lifecycle.js";
import { coversVersion, excludesVersion } from "./what-if/target.js";

export const STACK_CONTEXT_VERSION = "offing.stack-context.v1" as const;
export const STACK_CONTEXT_TOKEN_LIMIT = 1_000;
const literalVersion = /^v?\d{1,6}(?:\.\d{1,6}){0,2}$/u;
const endEvents = new Set(["end-of-life", "scheduled-end-of-life", "end-of-support", "removed"]);
const apiRuntime = new Map([
  ["pkg:generic/nodejs", "nodejs"],
  ["pkg:generic/python", "python"],
]);

interface SupportedLine {
  version: string;
  endOfLife: string;
  ruleId: string;
  source: string;
}

interface Component {
  kind: "runtime";
  component: string;
  inUse: string;
  status: "known" | "no-data";
  endOfLife: string | null;
  ruleId: string | null;
  source: string | null;
  supportedVersions: SupportedLine[];
}

interface Avoid {
  kind: "api" | "package";
  component: string;
  ruleId: string;
  replacement: string;
  endOfLife: string | null;
  source: string;
}

export interface StackContext {
  schemaVersion: typeof STACK_CONTEXT_VERSION;
  asOf: string;
  dataDate: string | null;
  status: "known" | "no-data";
  components: Component[];
  avoid: Avoid[];
  omitted: number;
}

type Ranked = { entry: Component | Avoid; severity: Severity };

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rank(a: Ranked, b: Ranked): number {
  return (
    severityValues.indexOf(b.severity) - severityValues.indexOf(a.severity) ||
    order(a.entry.endOfLife ?? "9999", b.entry.endOfLife ?? "9999") ||
    order(a.entry.component, b.entry.component) ||
    order(a.entry.ruleId ?? "", b.entry.ruleId ?? "") ||
    order("inUse" in a.entry ? a.entry.inUse : "", "inUse" in b.entry ? b.entry.inUse : "")
  );
}

function boundedReleaseVersion(range: string): string | undefined {
  const { constraints, scheme } = parseVersLenient(range);
  const [low, high] = constraints;
  if (constraints.length !== 2 || low?.comparator !== ">=" || high?.comparator !== "<") return undefined;
  const [major, minor = 0, patch = 0] = low.version.replace(/^v/u, "").split(".").map(Number);
  if (major === undefined || patch !== 0 || !literalVersion.test(low.version)) return undefined;
  const versions = versionScheme(scheme);
  const endsAtNextMajor = minor === 0 && versions.compare(high.version, `${major + 1}.0.0`) === 0;
  if (endsAtNextMajor) return String(major);
  if (versions.compare(high.version, `${major}.${minor + 1}.0`) === 0) return `${major}.${minor}`;
  return undefined;
}

/** A supported line must be an exact major or minor release interval with a reviewed end date. */
function releaseLine(rule: RegistryV2Rule, today: string): SupportedLine | undefined {
  const source = rule.sources[0]?.url;
  if (source === undefined || rule.deadline === undefined || rule.deadline <= today) return undefined;
  if (!endEvents.has(rule.event) || rule.event === "removed") return undefined;
  const version = boundedReleaseVersion(rule.vers);
  return version === undefined ? undefined : { version, endOfLife: rule.deadline, ruleId: rule.id, source };
}

function supportedLines(rules: readonly RegistryV2Rule[], today: string): SupportedLine[] {
  return rules
    .flatMap((rule) => {
      const line = releaseLine(rule, today);
      if (line === undefined) return [];
      const conflicting = rules.some(
        (other) =>
          other !== rule &&
          other.deadline !== undefined &&
          other.deadline <= today &&
          !excludesVersion(other.vers, line.version),
      );
      return conflicting ? [] : [line];
    })
    .sort((a, b) => order(a.endOfLife, b.endOfLife) || order(a.ruleId, b.ruleId));
}

function runtimeEntry(pin: RuntimePin, rules: readonly RegistryV2Rule[], today: string): Ranked {
  const prefix = RUNTIME_RULE_PREFIXES[pin.runtime];
  const own = rules.filter((rule) => prefix !== undefined && rule.id.startsWith(prefix) && endEvents.has(rule.event));
  const match = own
    .filter((rule) => rule.deadline !== undefined && coversVersion(rule.vers, pin.value.replace(/^v/u, "")))
    .sort((a, b) => order(a.deadline ?? "9999", b.deadline ?? "9999") || order(a.id, b.id))[0];
  const supportedVersions = supportedLines(own, today);
  return {
    severity: match?.severity ?? "info",
    entry: {
      kind: "runtime",
      component: pin.runtime,
      inUse: pin.value,
      status: match?.deadline === undefined ? "no-data" : "known",
      endOfLife: match?.deadline ?? null,
      ruleId: match?.id ?? null,
      source: match?.sources[0]?.url ?? null,
      supportedVersions,
    },
  };
}

export function stackApiContracts(
  rules: readonly RegistryV2Rule[],
  pins: readonly RuntimePin[],
  asOf: string,
): SourceUsageContract[] {
  return rules.flatMap((rule) => {
    const runtime = apiRuntime.get(rule.purl);
    const matchers = rule.usage?.filter(({ kind }) => kind === "symbol") ?? [];
    if (runtime === undefined || matchers.length === 0 || !rule.replacement || rule.provenance.reviewedAt > asOf)
      return [];
    const observed = pins.some(
      ({ runtime: actual, value, ambiguous }) =>
        runtime === actual &&
        !ambiguous &&
        literalVersion.test(value) &&
        coversVersion(rule.vers, value.replace(/^v/u, "")),
    );
    return observed ? [{ id: rule.id, matchers }] : [];
  });
}

function avoidEntries(
  findings: ScanResult["findings"],
  rules: readonly RegistryV2Rule[],
  apiIds: ReadonlySet<string>,
): Ranked[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const observed = new Set([...findings.map(({ ruleId }) => ruleId), ...apiIds]);
  return [...observed].flatMap((id) => {
    const rule = byId.get(id);
    const source = rule?.sources[0]?.url;
    if (rule === undefined || !rule.replacement || source === undefined) return [];
    if (Object.values(RUNTIME_RULE_PREFIXES).some((prefix) => rule.id.startsWith(prefix))) return [];
    const api = apiIds.has(id);
    return [
      {
        severity: rule.severity,
        entry: {
          kind: api ? ("api" as const) : ("package" as const),
          component: api ? rule.title : rule.purl,
          ruleId: rule.id,
          replacement: rule.replacement,
          endOfLife: rule.deadline ?? null,
          source,
        },
      },
    ];
  });
}

function addWithinBudget(context: StackContext, entry: Component | Avoid): boolean {
  if (entry.kind === "runtime") context.components.push(entry);
  else context.avoid.push(entry);
  context.omitted -= 1;
  if (estimateTokens(serialized(context)) <= STACK_CONTEXT_TOKEN_LIMIT) return true;
  if (entry.kind === "runtime") context.components.pop();
  else context.avoid.pop();
  context.omitted += 1;
  return false;
}

/** Project observed pins and findings onto reviewed rules, with no I/O or wall clock. */
export function buildStackContext(
  scan: Pick<ScanResult, "scannedAt" | "data" | "findings">,
  rules: readonly RegistryV2Rule[],
  pins: readonly RuntimePin[],
  apiIds: ReadonlySet<string> = new Set(),
): StackContext {
  const asOf = scan.scannedAt.slice(0, 10);
  const reviewed = rules.filter((rule) => rule.provenance.reviewedAt <= asOf);
  const ranked = [
    ...pins
      .filter((pin) => !pin.ambiguous && literalVersion.test(pin.value))
      .map((pin) => runtimeEntry(pin, reviewed, asOf)),
    ...avoidEntries(scan.findings, reviewed, apiIds),
  ].sort(rank);
  const unique = new Map(ranked.map((item) => [JSON.stringify(item.entry), item]));
  const context: StackContext = {
    schemaVersion: STACK_CONTEXT_VERSION,
    asOf,
    dataDate: scan.data?.reviewedThrough || null,
    status: ranked.some(
      ({ entry }) => entry.kind !== "runtime" || entry.status === "known" || entry.supportedVersions.length > 0,
    )
      ? "known"
      : "no-data",
    components: [],
    avoid: [],
    omitted: unique.size,
  };
  for (const { entry } of unique.values()) {
    if (!addWithinBudget(context, entry)) break;
  }
  return context;
}

export function stackSummary(context: StackContext): string {
  const parts = context.components
    .slice(0, 3)
    .map(
      ({ component, inUse, endOfLife }) =>
        `${component} ${inUse}${endOfLife === null ? " (no data for this pin)" : ` (end of life ${endOfLife})`}`,
    );
  const total = context.avoid.length;
  if (total > 0)
    parts.push(`${total} observed package or API ${total === 1 ? "warning" : "warnings"} in stack_context`);
  if (context.omitted > 0) parts.push(`${context.omitted} additional entries omitted from stack_context`);
  return parts.length === 0 ? "Stack context: no-data." : `Stack context: ${parts.join("; ")}.`;
}
