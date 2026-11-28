import { getActiveData } from "@velella/ebb/data-source";
import { type RegistryV2Rule, validateRegistryV2 } from "@velella/ebb/registry";

import type { Finding, SourceUsage } from "./domain.js";
import { languageFor } from "./source-files.js";
import { parsedUsages } from "./usage/parsers.js";

type Runtime = "nodejs" | "python";

const rulesByData = new WeakMap<Awaited<ReturnType<typeof getActiveData>>, Map<Runtime, RegistryV2Rule[]>>();

async function usageRules(runtime: Runtime): Promise<RegistryV2Rule[]> {
  const data = await getActiveData();
  let byRuntime = rulesByData.get(data);
  if (!byRuntime) {
    byRuntime = new Map();
    rulesByData.set(data, byRuntime);
  }
  const cached = byRuntime.get(runtime);
  if (cached) return cached;
  const { rules } = validateRegistryV2(await data.read(`registry/${runtime}.json`));
  const applicable = rules.filter(
    (rule) => (rule.event === "deprecated" || rule.event === "removed") && rule.usage?.length,
  );
  byRuntime.set(runtime, applicable);
  return applicable;
}

function symbolFinding(rule: RegistryV2Rule, usage: SourceUsage, runtime: Runtime): Finding {
  const { id, title, summary, severity, replacement, deadline, migration, requires, sources } = rule;
  const { location } = usage;
  return {
    id: `${id}:${location.path}:${location.line}:${location.column}`,
    ruleId: id,
    detector: runtime === "nodejs" ? "npm" : "python",
    confidence: "exact",
    title,
    summary,
    severity,
    location,
    ...(replacement === undefined ? {} : { replacement }),
    ...(deadline === undefined ? {} : { deadline }),
    ...(migration === undefined ? {} : { migration }),
    ...(requires === undefined ? {} : { requires }),
    sources,
  };
}

export async function snippetSymbolFindings(path: string, content: string, event?: "removed"): Promise<Finding[]> {
  const language = languageFor(path);
  if (language !== "javascript" && language !== "typescript" && language !== "python") return [];
  const runtime = language === "python" ? "python" : "nodejs";
  const candidates = await usageRules(runtime);
  const rules = event ? candidates.filter((rule) => rule.event === event) : candidates;
  const matches = await parsedUsages(
    { absolutePath: path, path, language },
    content,
    rules.map((rule) => ({ id: rule.id, matchers: rule.usage ?? [] })),
  );
  return rules.flatMap((rule) => (matches?.get(rule.id) ?? []).map((usage) => symbolFinding(rule, usage, runtime)));
}
