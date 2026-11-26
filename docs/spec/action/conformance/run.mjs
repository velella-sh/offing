#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const DAY_MS = 86_400_000;

async function readJson(path) {
  assert.ok(isAbsolute(path), `Expected an absolute file path, got ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
}

async function checkClean(outputs) {
  assert.equal(outputs["finding-count"], "0");
  assert.equal(outputs["has-new-findings"], "false");
  for (const name of ["highest-severity", "next-eol-date", "next-eol-days", "badge-path", "badge-svg-path", "sarif-path"]) {
    assert.ok(Object.hasOwn(outputs, name), `Missing output: ${name}`);
    assert.equal(outputs[name], "", name);
  }
  assert.deepEqual(JSON.parse(outputs["findings-json"]), []);
  assert.deepEqual((await readJson(outputs["report-path"])).findings, []);
}

async function checkGate(outputs) {
  const report = await readJson(outputs["report-path"]);
  const findings = JSON.parse(outputs["findings-json"]);
  assert.ok(findings.length > 0);
  assert.equal(outputs["finding-count"], String(findings.length));
  assert.equal(outputs["has-new-findings"], "true");
  assert.match(outputs["highest-severity"], /^(high|critical)$/);
  assert.deepEqual(findings.map(({ id }) => id), report.findings.map(({ id }) => id));

  const deadline = findings.map((finding) => finding.deadline).filter(Boolean).sort()[0];
  assert.match(deadline, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(outputs["next-eol-date"], deadline);
  const scanDay = report.scannedAt.slice(0, 10);
  assert.equal(outputs["next-eol-days"], String((Date.parse(deadline) - Date.parse(scanDay)) / DAY_MS));

  const sarif = await readJson(outputs["sarif-path"]);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);
  const [{ tool, results }] = sarif.runs;
  assert.equal(tool.driver.name, "Offing");
  assert.deepEqual(
    results.map((result) => result.partialFingerprints["offingFindingId/v1"]).sort(),
    findings.map(({ id }) => id).sort(),
  );
  for (const result of results) {
    assert.equal(tool.driver.rules[result.ruleIndex].id, result.ruleId);
    assert.match(result.level, /^(error|warning|note)$/);
    assert.ok(result.message.text);
    assert.ok(result.locations[0].physicalLocation.artifactLocation.uri);
  }
}

const [scenario, outcome] = process.argv.slice(2);
const input = readFileSync(0, "utf8");
if (scenario === "clean") {
  assert.equal(outcome, "success");
  await checkClean(JSON.parse(input));
} else if (scenario === "gate") {
  assert.equal(outcome, "failure");
  await checkGate(JSON.parse(input));
} else {
  throw new Error("Usage: node run.mjs <clean|gate> <success|failure> < outputs.json");
}
console.log(`acc-action-v1: ${scenario} passed`);
