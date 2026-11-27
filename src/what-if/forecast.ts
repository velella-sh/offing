import { addMonths } from "@velella/ebb/forecast";
import { isIsoDate, type RegistryV2Rule } from "@velella/ebb/registry";
import type { ImageRules } from "../detectors/container/image-lifecycle.js";
import type { Finding, SourceLocation } from "../domain.js";
import { RUNTIME_RULE_PREFIXES } from "../upgrade/target-lifecycle.js";
import type { UpgradeTarget } from "../upgrade/types.js";
import {
  observedLiteral,
  pinFindings,
  pinLocation,
  projectedImageRule,
  replacesFinding,
  type ObservedPin,
  type projectPins,
} from "./pins.js";
import { coversVersion, excludesVersion, type targetSupport } from "./target.js";

export interface Deadline {
  date: string;
  rule: string;
  title: string;
  path: string;
  line?: number;
  source: string | null;
}

const identity = ({ rule, date, path, line }: Deadline): string => JSON.stringify([rule, date, path, line]);

function ordered(entries: readonly Deadline[]): Deadline[] {
  return [...new Map(entries.map((entry) => [identity(entry), entry])).values()].sort(
    (a, b) => a.date.localeCompare(b.date, "en") || identity(a).localeCompare(identity(b), "en"),
  );
}

function deadline(
  rule: string,
  date: string | undefined,
  title: string,
  location: SourceLocation,
  source: string | undefined | null,
  until: string,
): Deadline[] {
  if (!date || !isIsoDate(date) || date > until) return [];
  return [
    {
      date,
      rule,
      title,
      path: location.path,
      ...(location.line === undefined ? {} : { line: location.line }),
      source: source ?? null,
    },
  ];
}

function observedDeadline(finding: Finding, rules: ReadonlyMap<string, RegistryV2Rule>, until: string): Deadline[] {
  return deadline(
    finding.ruleId,
    rules.get(finding.ruleId)?.deadline ?? finding.deadline,
    finding.title,
    finding.location,
    finding.sources[0]?.url,
    until,
  );
}

type Pin = ReturnType<typeof projectPins>[number];
type Support = Awaited<ReturnType<typeof targetSupport>>;

function projectedDeadline(
  pin: Pin,
  support: Support,
  target: UpgradeTarget,
  images: ImageRules,
  until: string,
): Deadline[] {
  if (pin.change !== "substituted") return [];
  const imageRule = projectedImageRule(pin, images);
  if (imageRule)
    return deadline(imageRule.id, imageRule.deadline, imageRule.title, pin, imageRule.sources[0]?.url, until);
  if (support.rule === null) return [];
  return deadline(
    support.rule,
    support.date ?? undefined,
    `${target.runtime}@${target.version}`,
    pin,
    support.source,
    until,
  );
}

/** Lifecycle rules on exact pins still apply when the repository has no ecosystem manifest. */
export function supplementalDeadlines(
  observed: readonly Finding[],
  pins: readonly ObservedPin[],
  rules: readonly RegistryV2Rule[],
): Deadline[] {
  return pins.flatMap((pin) => {
    const version = observedLiteral(pin);
    const prefix = RUNTIME_RULE_PREFIXES[pin.runtime];
    if (
      !version ||
      !prefix ||
      observed.some(({ location, ruleId }) => pinLocation(location) === pinLocation(pin) && ruleId.startsWith(prefix))
    )
      return [];
    const rule = rules
      .filter(({ id, deadline: date, vers }) => id.startsWith(prefix) && date && coversVersion(vers, version))
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "", "en"))[0];
    return rule ? deadline(rule.id, rule.deadline, rule.title, pin, rule.sources[0]?.url, "9999-12-31") : [];
  });
}

function remainingSupplemental(
  entries: readonly Deadline[],
  pins: readonly Pin[],
  target: UpgradeTarget,
  rules: ReadonlyMap<string, RegistryV2Rule>,
): Deadline[] {
  const substituted = new Set(pins.filter(({ change }) => change === "substituted").map(pinLocation));
  return entries.filter((entry) => {
    const rule = rules.get(entry.rule);
    return !substituted.has(pinLocation(entry)) || !rule || !excludesVersion(rule.vers, target.version);
  });
}

export function projectForecast(
  observed: readonly Finding[],
  supplemental: readonly Deadline[],
  pins: readonly Pin[],
  target: UpgradeTarget,
  support: Support,
  rules: ReadonlyMap<string, RegistryV2Rule>,
  images: ImageRules,
  today: string,
  months: number,
) {
  const until = addMonths(today, months);
  // The scan is tied to the same day. Keep overdue obligations as well as dates inside the forecast horizon.
  const extra = supplemental.filter(({ date }) => date <= until);
  const before = ordered([...observed.flatMap((finding) => observedDeadline(finding, rules, until)), ...extra]);
  const removedFindings = new Set(
    pins.flatMap((pin) =>
      pinFindings(pin, target, observed)
        .filter((finding) => replacesFinding(pin, finding, rules, target))
        .map(({ id }) => id),
    ),
  );
  const after = ordered([
    ...observed
      .filter(({ id }) => !removedFindings.has(id))
      .flatMap((finding) => observedDeadline(finding, rules, until)),
    ...remainingSupplemental(extra, pins, target, rules),
    ...pins.flatMap((pin) => projectedDeadline(pin, support, target, images, until)),
  ]);
  const beforeKeys = new Set(before.map(identity));
  const afterKeys = new Set(after.map(identity));
  return {
    until,
    removed: before.filter((entry) => !afterKeys.has(identity(entry))),
    retained: before.filter((entry) => afterKeys.has(identity(entry))),
    added: after.filter((entry) => !beforeKeys.has(identity(entry))),
  };
}
