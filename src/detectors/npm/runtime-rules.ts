import semver from "semver";

export interface NodeRuntimeRule {
  major?: number;
  maximumMajor?: number;
  /** A release line with an announced end that has yet to arrive. */
  scheduled?: boolean;
}

export interface RuntimeRuleContext<Rule extends NodeRuntimeRule> {
  endedRules: Rule[];
  scheduledMajors: number[];
  newestRuleMajor: number;
}

/** Up to this line the detector has always listed every end-of-life line a range allows. */
const LEGACY_MAXIMUM_MAJOR = 20;

/**
 * The end-of-life candidates a declaration allows. A range whose lowest allowed version is at or below
 * Node.js 20 lists every line up to 20, as it always has. A range whose lowest version is a newer line is
 * checked against the newer lines too (up to `newestRuleMajor`) only if that floor line is itself end-of-life:
 * `>=21` is a problem, but `>=22` and `>=24` have supported floors, so the end-of-life lines 23 and 25 they
 * also allow are not a problem with the declaration. A scheduled line (announced end, not yet reached) is
 * reported only for a declaration whose lowest allowed version is that line and that allows nothing newer
 * (`^22`, `22.x`, a pinned `22`), never for a range such as `>=22` that merely allows it, and never extends
 * the end-of-life candidates (`hasRule` and `newestRuleMajor` ignore it).
 */
function runtimeMajors(
  value: string,
  newestRuleMajor: number,
  hasRule: (major: number) => boolean,
  scheduledMajors: number[] = [],
): number[] {
  const range = semver.validRange(value);
  if (!range) {
    const direct = /^(?:v)?(\d+)(?:\.\d+){0,2}$/.exec(value.trim());
    return direct?.[1] ? [Number.parseInt(direct[1], 10)] : [];
  }
  const floor = semver.minVersion(range)?.major ?? 0;
  // Past Node.js 20 only a floor that is itself end-of-life (a line with a rule) makes the declaration a problem.
  const maximum =
    floor > LEGACY_MAXIMUM_MAJOR ? (hasRule(floor) ? newestRuleMajor : LEGACY_MAXIMUM_MAJOR) : LEGACY_MAXIMUM_MAJOR;
  const candidates = Array.from({ length: maximum + 1 }, (_, index) => index);
  const ended = candidates.filter((major) => semver.intersects(range, `${major}.x`));
  return [
    ...ended,
    ...scheduledMajors.filter(
      (major) =>
        major === floor &&
        !ended.includes(major) &&
        semver.intersects(range, `${major}.x`) &&
        !semver.intersects(range, `>=${major + 1}.0.0`),
    ),
  ];
}

function ruleForMajor<Rule extends NodeRuntimeRule>(rules: readonly Rule[], major: number): Rule | undefined {
  return rules.find((rule) => rule.major === major || (rule.maximumMajor !== undefined && major <= rule.maximumMajor));
}

export function runtimeRuleContext<Rule extends NodeRuntimeRule>(nodeRules: readonly Rule[]): RuntimeRuleContext<Rule> {
  const endedRules = nodeRules.filter((rule) => !rule.scheduled);
  const scheduledMajors = nodeRules.flatMap((rule) => (rule.scheduled && rule.major !== undefined ? [rule.major] : []));
  const newestRuleMajor = Math.max(0, ...endedRules.map((rule) => rule.major ?? 0));
  return { endedRules, scheduledMajors, newestRuleMajor };
}

/** Match a manifest range or lock to the same Node release lines in both forecast entry points. */
export function matchingRuntimeRules<Rule extends NodeRuntimeRule>(
  value: string,
  rules: readonly Rule[],
  { endedRules, scheduledMajors, newestRuleMajor }: RuntimeRuleContext<Rule>,
  includeScheduled = true,
): Array<{ rule: Rule; major: number }> {
  const majors = runtimeMajors(
    value,
    newestRuleMajor,
    (major) => ruleForMajor(endedRules, major) !== undefined,
    includeScheduled ? scheduledMajors : [],
  );
  return majors.flatMap((major) => {
    const rule = ruleForMajor(rules, major);
    return rule ? [{ rule, major }] : [];
  });
}
