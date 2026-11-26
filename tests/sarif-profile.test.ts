import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import type { ScanResult } from "../src/domain.js";
import { renderSarif } from "../src/reporters.js";

const checker = resolve("docs/spec/sarif/conformance/check.mjs");
const { validateLifecycleSarif } = (await import(pathToFileURL(checker).href)) as {
  validateLifecycleSarif(log: unknown): string[];
};

async function report() {
  const sample = JSON.parse(await readFile("tests/fixtures/sarif-scan.json", "utf8")) as ScanResult;
  return JSON.parse(renderSarif(sample));
}

test("the reporter's rules and results satisfy the lifecycle property schema and the profile", async () => {
  const schema = JSON.parse(await readFile("docs/spec/sarif/properties.v1.schema.json", "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  const sarif = await report();
  assert.deepEqual(validateLifecycleSarif(sarif), []);
  const { tool, results } = sarif.runs[0];
  for (const { properties } of [...tool.driver.rules, ...results]) {
    assert.equal(validate(properties.offingLifecycle), true, JSON.stringify(validate.errors));
  }
  assert.equal(validate({ severity: "high", source: "relative.html" }), false);
  assert.equal(validate({ severity: "high", extra: true }), false);
});

test("the profile checker reports exact locations for invalid lifecycle data and references", async () => {
  const sarif = await report();
  const { tool, results } = sarif.runs[0];
  tool.driver.rules.push(tool.driver.rules[0]);
  const result = results[0];
  result.ruleIndex = -1;
  result.level = "warning";
  result.properties.offingLifecycle.severity = "high";
  result.locations[0].physicalLocation.artifactLocation.uri = "../outside";
  result.partialFingerprints = {};
  result.properties.offingLifecycle.endOfLifeDate = "2026-02-29";
  result.properties.offingLifecycle.source = "file:///evidence";
  result.properties.offingLifecycle.replacement = " ";
  const errors = validateLifecycleSarif(sarif).join("\n");
  assert.match(errors, /rules\[2\]\.id: duplicate/);
  assert.match(errors, /results\[0\]: ruleId and ruleIndex/);
  assert.match(errors, /results\[0\]: severity high requires SARIF level error/);
  assert.match(errors, /artifactLocation.uri: expected a repository-relative URI/);
  assert.match(errors, /partialFingerprints: missing offingFindingId/);
  assert.match(errors, /offingLifecycle.endOfLifeDate: expected a valid/);
  assert.match(errors, /offingLifecycle.source: expected an absolute HTTP/);
  assert.match(errors, /offingLifecycle.replacement: expected a non-blank string/);
  assert.match(validateLifecycleSarif(null).join("\n"), /expected a SARIF 2.1.0 object/);
});

test("the standalone checker runs outside the repository and distinguishes invalid JSON and profile failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "offing-sarif-profile-"));
  try {
    const script = join(dir, "check.mjs");
    await copyFile(checker, script);
    const file = join(dir, "input.sarif");
    const run = () => spawnSync(process.execPath, [script, file], { cwd: dir, encoding: "utf8" });
    const sarif = await report();
    sarif.runs.push({ tool: { driver: { name: "Another producer", rules: [] } }, results: [] });
    await writeFile(file, JSON.stringify(sarif));
    const pass = run();
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /acc-sarif-profile: profile v1 passed/);

    delete sarif.runs[0].tool.driver.rules[0].properties.offingLifecycle;
    await writeFile(file, JSON.stringify(sarif));
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /rules\[0\]\.properties\.offingLifecycle/);

    await writeFile(file, "not JSON");
    assert.equal(run().status, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
