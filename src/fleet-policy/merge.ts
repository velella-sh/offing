import { severityValues, type LifecyclePolicy, type PolicyException, type PolicyRule } from "../domain.js";
import { ConfigError } from "../config.js";

export const ruleKeys = ["days-left", "after-eol", "severity", "path", "ecosystem"] as const;
type RuleKey = (typeof ruleKeys)[number];
export type RelaxationKey = RuleKey | "exceptions";

export interface PolicySource {
  file: string;
  line: number;
}

export interface PolicyLayer {
  name: "organization" | "team" | "repository";
  rules: readonly PolicyRule[];
  exceptions: readonly PolicyException[];
  source: (path: readonly (string | number)[]) => PolicySource;
}

export interface EffectiveRule {
  rule: PolicyRule;
  origins: Partial<Record<RuleKey, PolicySource & { layer: PolicyLayer["name"] }>>;
}

export interface EffectivePolicy {
  policy: LifecyclePolicy;
  rules: EffectiveRule[];
  exceptions: { exception: PolicyException; source: PolicySource; layer: PolicyLayer["name"] }[];
}

export class FleetPolicyError extends ConfigError {
  constructor(
    message: string,
    readonly reason: "expired-exception" | "unauthorized-override",
  ) {
    super(message);
  }
}

function formatSource(source: PolicySource): string {
  return `${source.file}:${source.line}`;
}

function tightens(before: PolicyRule, after: PolicyRule, key: RuleKey): boolean {
  if (before[key] === after[key]) return true;
  switch (key) {
    case "days-left":
      return before[key] !== undefined && after[key] !== undefined && after[key] >= before[key];
    case "severity":
      return (
        before[key] !== undefined &&
        after[key] !== undefined &&
        severityValues.indexOf(after[key]) <= severityValues.indexOf(before[key])
      );
    case "after-eol":
    case "path":
    case "ecosystem":
      return false;
  }
}

function mergeRule(
  previous: EffectiveRule | undefined,
  rule: PolicyRule,
  layer: PolicyLayer,
  index: number,
  allowed: ReadonlySet<RelaxationKey>,
): EffectiveRule {
  const merged = { ...previous?.rule, ...rule };
  const origins = { ...previous?.origins };
  for (const key of ruleKeys) {
    if (rule[key] === undefined) continue;
    const source = layer.source(["rules", index, key]);
    const existing = previous?.rule;
    if (existing && !allowed.has(key) && !tightens(existing, merged, key)) {
      throw new FleetPolicyError(
        `${formatSource(source)} loosens rule ${rule.id} (${key}) set at ${formatSource(origins[key] ?? Object.values(origins)[0] ?? layer.source([]))}.`,
        "unauthorized-override",
      );
    }
    origins[key] = { ...source, layer: layer.name };
  }
  return { rule: merged, origins };
}

function checkedException(
  exception: PolicyException,
  layer: PolicyLayer,
  index: number,
  organization: PolicyLayer,
  today: string,
  allowed: ReadonlySet<RelaxationKey>,
): EffectivePolicy["exceptions"][number] {
  const source = layer.source(["exceptions", index]);
  if (!exception.owner?.trim()) throw new ConfigError(`${formatSource(source)} requires an exception owner.`);
  if (exception.expires < today)
    throw new FleetPolicyError(
      `${formatSource(source)} exception expired on ${exception.expires}.`,
      "expired-exception",
    );
  if (layer !== organization && !allowed.has("exceptions")) {
    throw new ConfigError(
      `${formatSource(source)} adds an exception without permission from ${formatSource(organization.source([]))}.`,
    );
  }
  return { exception, source, layer: layer.name };
}

export function mergeFleetPolicy(
  organization: PolicyLayer,
  lowerLayers: readonly PolicyLayer[],
  allowLoosen: readonly RelaxationKey[],
  today: string,
): EffectivePolicy {
  const allowed = new Set(allowLoosen);
  const rules = new Map<string, EffectiveRule>();
  const exceptions: EffectivePolicy["exceptions"] = [];
  for (const layer of [organization, ...lowerLayers]) {
    const seen = new Set<string>();
    layer.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        throw new ConfigError(`${formatSource(layer.source(["rules", index]))} repeats rule ${rule.id}.`);
      }
      seen.add(rule.id);
      rules.set(rule.id, mergeRule(rules.get(rule.id), rule, layer, index, allowed));
    });
    exceptions.push(
      ...layer.exceptions.map((exception, index) =>
        checkedException(exception, layer, index, organization, today, allowed),
      ),
    );
  }
  return {
    policy: {
      rules: [...rules.values()].map(({ rule }) => rule),
      exceptions: exceptions.map(({ exception }) => exception),
    },
    rules: [...rules.values()],
    exceptions,
  };
}
