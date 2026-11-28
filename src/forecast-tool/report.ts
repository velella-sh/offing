import type { LifecycleFinding } from "@velella/ebb/domain";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { versContains } from "@velella/ebb/vers";

import type { UnclassifiedReference } from "../domain.js";
import { buildForecastReport } from "../forecast-core.js";
import { parseNpm } from "./parse-lock.js";
import { parsePyproject, parseRequirements } from "./parse-python.js";
import { parseWorkflow } from "./parse-workflow.js";
import type { ForecastData } from "./data.js";
import type { Reference } from "./references.js";

function readReferences(contents: string, data: ForecastData, path?: string): Reference[] {
  const text = contents.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("Choose a file or paste its contents.");
  if (/\.json$/i.test(path ?? "") || /^\s*\{/.test(text)) return parseNpm(text, path);
  if (/\.toml$/i.test(path ?? "") || /^\s*\[(?:project|build-system|tool\.)/m.test(text)) {
    return parsePyproject(text, path);
  }
  if (/\.ya?ml$/i.test(path ?? "") || /^jobs\s*:/m.test(text)) return parseWorkflow(text, path, data.actionVersions);
  if (!path || /\.txt$/i.test(path)) return parseRequirements(text, path);
  throw new Error("Choose a supported npm, Python or GitHub Actions file.");
}

function matchingRules(rules: readonly RegistryV2Rule[], version: string): RegistryV2Rule[] {
  return rules.filter((rule) => versContains(rule.vers, version));
}

function reportFromReferences(
  references: Reference[],
  data: ForecastData,
  today: string,
  root: string,
  limit = Infinity,
) {
  const indexed = new Map<string, RegistryV2Rule[]>();
  for (const rule of data.rules) {
    if (rule.usage?.length) continue;
    const entries = indexed.get(rule.purl) ?? [];
    entries.push(rule);
    indexed.set(rule.purl, entries);
  }

  const findings: LifecycleFinding[] = [];
  const replacements: Array<{ id: string; replacement?: string }> = [];
  const noData: UnclassifiedReference[] = [];
  for (const { purl, version, location } of references) {
    const rules = indexed.get(purl);
    if (!rules || !version) {
      noData.push({
        component: purl,
        reference: version ? `${purl}@${version}` : purl,
        location,
        detector: "forecast-web",
        reason: version ? "no lifecycle rule for the component" : "no supported version in the declaration",
      });
      continue;
    }
    for (const rule of matchingRules(rules, version)) {
      if (findings.length === limit)
        throw new Error("The input contains too many lifecycle findings for the forecast.");
      const id = `${rule.id}:${findings.length}`;
      findings.push({ ...rule, id, ruleId: rule.id, detector: rule.ecosystem, location });
      if (rule.replacement) replacements.push({ id, replacement: rule.replacement });
    }
  }
  const forecast = buildForecastReport({ root, findings }, data.rules, today, 12, noData);
  return { forecast, replacements, checked: references.length };
}

export function createReport(contents: string, data: ForecastData, today: string, path?: string) {
  return reportFromReferences(readReferences(contents, data, path), data, today, path ?? "");
}

const toolLimit = 10_000;

function checkDeclarationLimit(total: number): void {
  if (total > toolLimit) throw new Error("The input contains too many declarations for the forecast.");
}

export function createToolReport(contents: string, data: ForecastData, today: string, path?: string) {
  const references = readReferences(contents, data, path);
  checkDeclarationLimit(references.length);
  return reportFromReferences(references, data, today, path ?? "", toolLimit);
}

/** Parse verified repository files without allowing an unreadable manifest to hide the rest. */
export function createRepositoryReport(
  files: readonly { path: string; contents: string }[],
  data: ForecastData,
  today: string,
  root: string,
) {
  const references: Reference[] = [];
  const read: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const { contents, path } of files) {
    let entries: Reference[];
    try {
      entries = readReferences(contents, data, path);
    } catch {
      skipped.push({ path, reason: contents.trim() ? "Unsupported or invalid file contents." : "File is empty." });
      continue;
    }
    checkDeclarationLimit(references.length + entries.length);
    references.push(...entries);
    read.push(path);
  }
  return { report: reportFromReferences(references, data, today, root, toolLimit), read, skipped };
}
