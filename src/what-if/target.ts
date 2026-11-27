import { lookupProduct, LookupError } from "@velella/ebb/lookup";
import type { LookupFinding } from "@velella/ebb/lookup";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { parseVersLenient, versContains, versionScheme } from "@velella/ebb/vers";
import { planUpgradePathForRule } from "../migration-packet.js";
import { OffingError } from "../offing-error.js";
import { parseUpgradeTarget } from "../upgrade/index.js";
import { primaryFinding } from "../upgrade/target-lifecycle.js";
import type { UpgradeTarget } from "../upgrade/types.js";

const versions = /^\d{1,6}(?:\.\d{1,6}){0,2}$/u;
const runtime = /^[a-z][a-z0-9-]{0,39}$/u;
const endingEvents = new Set(["end-of-life", "end-of-support", "removed", "scheduled-end-of-life"]);

/** Literal numeric release lines only. A report evaluates them independently, in the order provided. */
export function simulationTargets(values: readonly string[]): UpgradeTarget[] {
  if (values.length === 0 || values.length > 8) {
    throw new OffingError("invalid-argument", "Supply one to eight runtime targets.");
  }
  return values.map((value) => {
    const target = parseUpgradeTarget(value);
    if (!target || !runtime.test(target.runtime) || !versions.test(target.version)) {
      throw new OffingError("invalid-argument", "Targets must use a literal runtime@version, such as nodejs@22.");
    }
    return target;
  });
}

function bounds(version: string): [string, string] {
  const parts = version.split(".");
  const remaining = 3 - parts.length;
  return [
    [...parts, ...Array<string>(remaining).fill("0")].join("."),
    [...parts, ...Array<string>(remaining).fill("1000000")].join("."),
  ];
}

/** A single disjoint constraint proves that the proposed line cannot match the observed lifecycle rule. */
export function excludesVersion(vers: string, target: string): boolean {
  try {
    const parsed = parseVersLenient(vers);
    const scheme = versionScheme(parsed.scheme);
    const [first, last] = bounds(target);
    return parsed.constraints.some(({ comparator, version }) => {
      if (!versions.test(version)) return false;
      const low = scheme.compare(first, version);
      const high = scheme.compare(last, version);
      switch (comparator) {
        case "<":
          return low >= 0;
        case "<=":
          return low > 0;
        case ">":
          return high <= 0;
        case ">=":
          return high < 0;
        case "=":
          return low > 0 || high < 0;
        default:
          return false;
      }
    });
  } catch {
    return false;
  }
}

/** Both endpoints suffice for simple contiguous intervals. Decline disjoint version clauses. */
export function coversVersion(vers: string, version: string): boolean {
  try {
    const parsed = parseVersLenient(vers);
    if (parsed.constraints.some((constraint) => constraint.comparator === "!=")) return false;
    const [first, last] = bounds(version);
    return versContains(parsed, first) && versContains(parsed, last);
  } catch {
    return false;
  }
}

async function lookupTarget(target: UpgradeTarget): Promise<LookupFinding | undefined> {
  try {
    const result = await lookupProduct(target.runtime, target.version);
    const own = primaryFinding(target.runtime, result.findings);
    return own && endingEvents.has(own.event) ? own : undefined;
  } catch (error) {
    if (error instanceof LookupError) return undefined;
    throw error;
  }
}

export async function targetSupport(target: UpgradeTarget, today: string, rules: readonly RegistryV2Rule[]) {
  const rule = await lookupTarget(target);
  if (!rule || (rule.deadline === undefined && rule.event === "scheduled-end-of-life"))
    return { status: "no-data" as const, rule: null, date: null, source: null, next: null };
  const date = rule.deadline ?? null;
  const ended = rule.event === "end-of-support" || date === null || date <= today;
  const next = planUpgradePathForRule(rule.ruleId, rules, today)?.target;
  return {
    status: ended ? ("ended" as const) : ("dated" as const),
    rule: rule.ruleId,
    date,
    source: rule.sources[0]?.url ?? null,
    next:
      date && next?.endsOn && next.endsOn > date && next.versions ? { range: next.versions, date: next.endsOn } : null,
  };
}
