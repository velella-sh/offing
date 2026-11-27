import { getActiveData } from "@velella/ebb/data-source";
import { parsePurl, purlIdentity } from "@velella/ebb/purl";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { daysBetween } from "../baseline.js";
import { checkAgainst, type DependencyFinding } from "../check-dependency.js";
import type { UnclassifiedReference } from "../domain.js";
import { OffingError } from "../offing-error.js";
import { readSbomDocument } from "../sbom-scan.js";
import { scanSbomInput } from "../sbom/input.js";
import { lifecycleRules } from "../sbom/lifecycle.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import { VERSION } from "../version.js";
import {
  artifactSubject,
  ebbSnapshot,
  PREDICATE_TYPE,
  STATEMENT_TYPE,
  type ComponentIdentity,
  type LifecycleComponent,
  type LifecyclePredicate,
  type LifecycleRule,
  type LifecycleStatement,
} from "./statement.js";

type Observations = Pick<LifecyclePredicate, "components" | "noData">;
type RuleDetails = Pick<DependencyFinding, "ruleId" | "event" | "deadline" | "sources" | "replacement">;

function eventAtBuild(rule: RuleDetails, builtOn: string): LifecycleRule {
  return {
    ruleId: rule.ruleId,
    event: rule.event,
    sources: [...new Set(rule.sources.map(({ url }) => url))].sort(),
    ...(rule.deadline ? { date: rule.deadline, daysLeftAtBuild: daysBetween(builtOn, rule.deadline) } : {}),
    ...(rule.replacement ? { replacement: rule.replacement } : {}),
  };
}

function packageRules(rules: readonly RegistryV2Rule[]): Map<string, RegistryV2Rule[]> {
  const byPurl = new Map<string, RegistryV2Rule[]>();
  for (const rule of rules) {
    if (rule.usage?.some((usage) => usage.kind === "symbol")) continue;
    const entries = byPurl.get(rule.purl) ?? [];
    entries.push(rule);
    byPurl.set(rule.purl, entries);
  }
  return byPurl;
}

async function sbomComponents(file: string, rules: readonly RegistryV2Rule[], builtOn: string): Promise<Observations> {
  const noData: ComponentIdentity[] = [];
  const components: LifecycleComponent[] = [];
  const byPurl = packageRules(rules);
  const entries = await scanSbomInput(await readSbomDocument(file), {
    check: ({ purl, version }) =>
      checkAgainst(byPurl.get(purlIdentity(parsePurl(purl))) ?? [], {
        purl,
        ...(version?.trim() ? { version } : {}),
      }),
    onMissingPurl(name, location) {
      noData.push({ name, location });
    },
  });
  for (const { purl, status, location, version, findings } of entries) {
    const identity = { purl, ...(version ? { version } : {}), location };
    if (status === "no-data") noData.push(identity);
    else components.push({ ...identity, status, rules: findings.map((rule) => eventAtBuild(rule, builtOn)) });
  }
  return { components, noData };
}

function unclassifiedIdentity(reference: UnclassifiedReference): ComponentIdentity {
  const location = reference.location.path;
  const name = reference.component;
  if (name.startsWith("pkg:")) {
    try {
      const parsed = parsePurl(name);
      return { purl: purlIdentity(parsed), ...(parsed.version ? { version: parsed.version } : {}), location };
    } catch {
      // An unclassified reference is not guaranteed to carry a valid PURL.
    }
  }
  return { name, location };
}

async function scanComponents(path: string, rules: readonly RegistryV2Rule[], builtOn: string): Promise<Observations> {
  const scan = await scanWithBuiltIns(path);
  const registry = new Map(rules.map((rule) => [rule.id, rule]));
  const components = new Map<string, LifecycleComponent>();
  for (const finding of scan.findings) {
    const rule = registry.get(finding.ruleId);
    if (!rule) throw new OffingError("data-unavailable", `No Ebb metadata for observed rule ${finding.ruleId}.`);
    const location = finding.location.path;
    const key = JSON.stringify([rule.purl, location]);
    const component = components.get(key) ?? { purl: rule.purl, location, status: "affected", rules: [] };
    if (!component.rules.some(({ ruleId }) => ruleId === rule.id)) {
      component.rules.push(eventAtBuild({ ...rule, ruleId: rule.id }, builtOn));
    }
    components.set(key, component);
  }
  const noData = (scan.unclassified?.references ?? []).map(unclassifiedIdentity);
  return { components: [...components.values()], noData };
}

export async function buildStatement(path: string, subject: string, sbom?: string): Promise<LifecycleStatement> {
  const builtOn = new Date().toISOString().slice(0, 10);
  const artifact = await artifactSubject(subject);
  const active = await getActiveData();
  const rules = await lifecycleRules(active);
  const observations =
    sbom === undefined ? await scanComponents(path, rules, builtOn) : await sbomComponents(sbom, rules, builtOn);
  return {
    _type: STATEMENT_TYPE,
    subject: [artifact],
    predicateType: PREDICATE_TYPE,
    predicate: {
      builtOn,
      offingVersion: VERSION,
      ebb: ebbSnapshot(active),
      input: sbom === undefined ? "scan" : "sbom",
      ...observations,
    },
  };
}
