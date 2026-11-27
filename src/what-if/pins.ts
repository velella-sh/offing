import type { RegistryV2Rule } from "@velella/ebb/registry";
import { imageLifecycle, type ImageRules } from "../detectors/container/image-lifecycle.js";
import { parseImageReference } from "../detectors/container/parse-image.js";
import type { Finding } from "../domain.js";
import type { ImageLineage, LineageLink } from "../lineage/index.js";
import { imagePin, pinDiffersFromTarget, RUNTIME_RULE_PREFIXES, type RuntimePin } from "../upgrade/target-lifecycle.js";
import type { UpgradeTarget } from "../upgrade/types.js";
import { excludesVersion } from "./target.js";

const numericPin = /^v?\d{1,6}(?:\.\d{1,6}){0,2}$/u;
const imageTag = /^(\d{1,6}(?:\.\d{1,6}){0,2})(?:-([a-z\d-]+))?$/u;

export interface ObservedPin extends RuntimePin {
  readonly lineage?: string[];
}

interface ProjectedPin extends ObservedPin {
  readonly replacement: string | null;
  readonly change: "substituted" | "unresolved";
}

const containerName: Record<string, string> = { nodejs: "node", go: "golang" };

const key = ({ path, line, value }: RuntimePin) => JSON.stringify([path, line, value]);

function lineagePin(link: LineageLink, chain: string[]): ObservedPin[] {
  if (link.relationship !== "from" && link.relationship !== "image") return [];
  const literal = link.resolvedReference ?? link.reference;
  const pin = imagePin(literal, link.line, link.path);
  return pin ? [{ ...pin, value: link.reference, lineage: chain }] : [];
}

export function observedPins(pins: readonly RuntimePin[], lineage: ImageLineage): ObservedPin[] {
  const known = new Map(pins.map((pin) => [key(pin), pin]));
  for (const chain of lineage.chains) {
    const references = [...new Set(chain.links.map((link) => link.resolvedReference ?? link.reference))];
    for (const link of chain.links) {
      for (const pin of lineagePin(link, references)) known.set(key(pin), pin);
    }
  }
  return [...known.values()].sort((a, b) => a.path.localeCompare(b.path, "en") || a.line - b.line);
}

function replaceImage(pin: ObservedPin, target: UpgradeTarget): ProjectedPin {
  const image = parseImageReference(pin.value);
  const tag = imageTag.exec(image?.tag ?? "");
  if (image === undefined || image.digest !== undefined || !tag || tag[2]) {
    return { ...pin, replacement: null, change: "unresolved" };
  }
  return {
    ...pin,
    replacement: pin.value.slice(0, pin.value.lastIndexOf(":") + 1) + target.version,
    change: "substituted",
  };
}

export const pinLocation = (pin: { path: string; line?: number }): string => JSON.stringify([pin.path, pin.line]);

export function projectPins(pins: readonly ObservedPin[], target: UpgradeTarget): ProjectedPin[] {
  const counts = new Map<string, number>();
  for (const pin of pins) counts.set(pinLocation(pin), (counts.get(pinLocation(pin)) ?? 0) + 1);
  return pins
    .filter((pin) => pin.runtime === target.runtime && pinDiffersFromTarget(pin, target))
    .map(({ ambiguous, ...pin }) => {
      if (ambiguous || counts.get(pinLocation(pin)) !== 1) return { ...pin, replacement: null, change: "unresolved" };
      if (pin.field === "FROM") return replaceImage(pin, target);
      const exact = numericPin.test(pin.value);
      return { ...pin, replacement: exact ? target.version : null, change: exact ? "substituted" : "unresolved" };
    });
}

export function observedLiteral(pin: ObservedPin): string | undefined {
  const version = pin.value.replace(/^v/u, "");
  return pin.field !== "FROM" && !pin.ambiguous && numericPin.test(version) ? version : undefined;
}

export function pinFindings(pin: RuntimePin, target: UpgradeTarget, findings: readonly Finding[]): Finding[] {
  const prefix = RUNTIME_RULE_PREFIXES[target.runtime];
  return findings.filter(({ location, ruleId }) => {
    if (location.path !== pin.path || location.line !== pin.line) return false;
    return (
      (prefix !== undefined && ruleId.startsWith(prefix)) ||
      (pin.field === "FROM" && ruleId.startsWith(`container.${containerName[target.runtime] ?? target.runtime}.`))
    );
  });
}

/** Matching the old rule is necessary even when the target lookup has no newly dated line. */
export function replacesFinding(
  pin: ProjectedPin,
  finding: Finding,
  rules: ReadonlyMap<string, RegistryV2Rule>,
  target: UpgradeTarget,
): boolean {
  const rule = rules.get(finding.ruleId);
  return pin.change === "substituted" && rule !== undefined && excludesVersion(rule.vers, target.version);
}

export function projectedImageRule(pin: ProjectedPin, rules: ImageRules): RegistryV2Rule | undefined {
  const image = pin.field === "FROM" && pin.replacement ? parseImageReference(pin.replacement) : undefined;
  return image ? imageLifecycle(image, rules).rule : undefined;
}
