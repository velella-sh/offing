import { loadDataFile } from "@velella/ebb/data-source";
import { validateRegistryV2 } from "@velella/ebb/registry";
import { versContains } from "@velella/ebb/vers/index";
import semver from "semver";

import { ruleFinding } from "../../rule-finding.js";
import type { DetectorFinding, DetectorUnclassifiedReference } from "../../sdk.js";
import { noVersionData } from "../../version-files/mise.js";
import { member, readJsonLines } from "../json-lines.js";

interface DevEngine {
  name: string;
  version: string;
  line: number;
}

export function devEngineEntries(contents: string, section: "runtime" | "packageManager"): DevEngine[] {
  if (!contents.includes('"devEngines"') && !contents.includes("\\")) return [];
  const engines = member(readJsonLines(contents, { comments: false }), "devEngines")?.value;
  const field = member(engines, section)?.value;
  const entries = field?.kind === "array" ? field.items : [field];
  return entries.flatMap((entry) => {
    const name = member(entry, "name")?.value;
    const version = member(entry, "version");
    if (name?.kind !== "string" || !name.value.trim()) return [];
    return [
      {
        name: name.value,
        version: version?.value.kind === "string" ? version.value.value : "",
        line: version?.keyLine ?? name.line,
      },
    ];
  });
}

/** Apply Ebb's Deno and Bun runtime rules to tool versions declared by devEngines. */
export async function otherDevEngineFindings(
  path: string,
  contents: string,
  unclassified: DetectorUnclassifiedReference[],
): Promise<DetectorFinding[]> {
  const runtimes = devEngineEntries(contents, "runtime").filter(({ name }) => name !== "node" && name !== "nodejs");
  const managers = devEngineEntries(contents, "packageManager");
  const entries = [
    ...runtimes.map((entry) => ({ ...entry, section: "runtime" })),
    ...managers.map((entry) => ({ ...entry, section: "packageManager" })),
  ];
  const findings: DetectorFinding[] = [];
  const rules = entries.some(({ name }) => name === "bun" || name === "deno")
    ? validateRegistryV2(await loadDataFile("registry/deno.json")).rules
    : [];
  for (const { name, version, line, section } of entries) {
    const purl = name === "bun" || name === "deno" ? `pkg:generic/${name}` : name;
    const candidates = rules.filter((rule) => rule.purl === purl);
    const exact = semver.valid(version);
    if (!exact || candidates.length === 0) {
      unclassified.push(noVersionData(path, line, purl, version ? `${name}@${version}` : name));
      continue;
    }
    const rule = candidates.find((candidate) => versContains(candidate.vers, exact));
    if (rule)
      findings.push(ruleFinding(rule, path, line, `devEngines.${section} pins ${name} ${version}. ${rule.summary}`));
  }
  return findings;
}
