#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const vectors = JSON.parse(await readFile(new URL("fixtures.json", import.meta.url), "utf8"));
const midnight = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

function confirmedReason(deadline, exceptions) {
  const applicable = exceptions.filter(({ path, ecosystem }) =>
    (!path || path === vectors.path) && (!ecosystem || ecosystem === vectors.detector),
  );
  const expired = applicable.find(({ expires }) => expires < vectors.asOf);
  const exception = expired ?? applicable[0];
  const outcome = !exception || expired ? "block" : "excepted";
  const result = ["lifecycle", outcome, midnight(deadline) - midnight(vectors.asOf)];
  return exception ? [...result, exception.reason] : result;
}

function referenceDecision({ deadline, event, exceptions = [], noData = "warn", predicted, predictionDate }) {
  const reasons = [];
  const confirmed = deadline !== undefined && event !== "deprecated";
  if (confirmed && deadline <= vectors.supportUntil) reasons.push(confirmedReason(deadline, exceptions));
  if (!confirmed && event !== "deprecated" && noData !== "ignore") {
    reasons.push(["no-data", noData === "fail" ? "block" : "warn"]);
  }
  if (predicted && !confirmed && (predictionDate ?? vectors.prediction.date) <= vectors.supportUntil) {
    reasons.push(["prediction", "warn"]);
  }
  const outcomes = new Set(reasons.map(([, outcome]) => outcome));
  return [outcomes.has("block") ? "block" : outcomes.has("warn") ? "warn" : "pass", ...reasons];
}

for (const vector of vectors.cases) assert.deepEqual(referenceDecision(vector), vector.expected, vector.name);
console.log(`acc-release-gate: ${vectors.cases.length} standalone decision fixtures passed`);
