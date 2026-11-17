import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { BUNDLED_ECOSYSTEMS } from "@velella/ebb/data/ecosystems";

import { readCorpus, readSnapshot } from "./run.js";

async function registryDeadlines(): Promise<Map<string, string | undefined>> {
  const deadlines = new Map<string, string | undefined>();
  for (const ecosystem of BUNDLED_ECOSYSTEMS) {
    const file = import.meta.resolve(`@velella/ebb/registry/${ecosystem}.json`);
    const { rules } = JSON.parse(await readFile(new URL(file), "utf8")) as {
      rules: { id: string; deadline?: string }[];
    };
    for (const rule of rules) deadlines.set(rule.id, rule.deadline);
  }
  return deadlines;
}

const { repositories } = await readCorpus();
const deadlines = await registryDeadlines();
const findings = (await Promise.all(repositories.map(readSnapshot))).flatMap((forecast) =>
  forecast.groups.flatMap(({ events }) =>
    events.flatMap((event) =>
      event.findings.map(({ path, line }) => ({
        repository: forecast.root,
        ruleId: event.ruleId,
        date: event.date,
        path,
        line,
      })),
    ),
  ),
);

// Check the first occurrence of each rule before spending the rest of the sample on repeat occurrences.
const firstByRule = new Map<string, (typeof findings)[number]>();
const repeats = [];
for (const finding of findings) {
  if (firstByRule.has(finding.ruleId)) repeats.push(finding);
  else firstByRule.set(finding.ruleId, finding);
}
const sample = [...firstByRule.values(), ...repeats].slice(0, 50);
assert.equal(sample.length, 50, "not enough findings for a 50-reference date check");
const differences = sample.filter(({ ruleId, date }) => deadlines.get(ruleId) !== date);
for (const { ruleId, date, repository, path, line } of differences) {
  console.error(
    `${repository} ${path}:${line ?? "?"} ${ruleId}: forecast ${date}, Ebb ${deadlines.get(ruleId) ?? "(no date)"}`,
  );
}
console.log(`${sample.length} finding dates checked against bundled Ebb rules; ${differences.length} differences.`);
if (differences.length > 0) process.exitCode = 1;
