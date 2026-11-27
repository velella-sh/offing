#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const vectors = JSON.parse(await readFile(new URL("fixtures.json", import.meta.url), "utf8"));

function referenceDecision({ deadline, expires, noData }) {
  if (deadline === undefined) {
    if (noData === "ignore") return ["pass"];
    const outcome = noData === "fail" ? "block" : "warn";
    return [outcome, outcome];
  }

  const midnight = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  if (midnight(deadline) > midnight(vectors.supportUntil)) return ["pass"];
  const daysLeft = midnight(deadline) - midnight(vectors.asOf);
  if (expires && midnight(expires) >= midnight(vectors.asOf)) return ["pass", "excepted", daysLeft];
  return ["block", "block", daysLeft];
}

for (const vector of vectors.cases) assert.deepEqual(referenceDecision(vector), vector.expected, vector.name);
console.log(`acc-release-gate: ${vectors.cases.length} standalone decision fixtures passed`);
