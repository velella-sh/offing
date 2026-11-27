import { BUNDLED_ECOSYSTEMS } from "@velella/ebb/data-bundle";
import { getActiveData } from "@velella/ebb/data-source";
import type { ActiveData } from "@velella/ebb/data-source";
import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";

export const milestoneNames: Partial<Record<RegistryV2Rule["event"], string>> = {
  "end-of-support": "endOfSupport",
  "end-of-life": "endOfLife",
  "scheduled-end-of-life": "endOfLife",
};

export function milestoneCandidates(rules: readonly RegistryV2Rule[]): RegistryV2Rule[] {
  return rules
    .filter(
      (rule) => rule.deadline && milestoneNames[rule.event] && !rule.usage?.some((usage) => usage.kind === "symbol"),
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export async function lifecycleRules(data?: ActiveData): Promise<RegistryV2Rule[]> {
  const active = data ?? (await getActiveData());
  const registries = await Promise.all(
    BUNDLED_ECOSYSTEMS.map(async (ecosystem) => validateRegistryV2(await active.read(`registry/${ecosystem}.json`))),
  );
  return registries.flatMap((registry) => registry.rules);
}

export function lifecyclePackageRules(rules: readonly RegistryV2Rule[]): Map<string, RegistryV2Rule[]> {
  const byPurl = new Map<string, RegistryV2Rule[]>();
  for (const rule of rules) {
    if (rule.usage?.some((usage) => usage.kind === "symbol")) continue;
    const entries = byPurl.get(rule.purl) ?? [];
    entries.push(rule);
    byPurl.set(rule.purl, entries);
  }
  return byPurl;
}
