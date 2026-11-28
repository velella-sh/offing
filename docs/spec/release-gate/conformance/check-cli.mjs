#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [cliPath, ...attestation] = process.argv.slice(2);
assert(cliPath, "Usage: node check-cli.mjs <path to installed cli.js> [bundle artifact tampered-artifact trusted-root repository workflow]");
const cli = resolve(cliPath);
const formats = ["text", "json", "sarif"];
const bundled = { ...process.env, OFFING_DATA_VERSION: "bundled" };

function invoke(cwd, args, format, status, env = bundled) {
  const result = spawnSync(process.execPath, [cli, ...args, "--format", format], {
    cwd, env, encoding: "utf8", timeout: 90_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${args[0]} ${format}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function verify(cwd, args, expected, status) {
  const [text, json, sarif] = formats.map((format) => invoke(cwd, args, format, status));
  const report = JSON.parse(json);
  const run = JSON.parse(sarif).runs[0];
  assert.equal(report.schemaVersion, "offing.release-gate.v1");
  assert.deepEqual(run.properties.offingReleaseGate, report);
  assert.deepEqual(report.decisions.map(({ input, verdict }) => [input.kind, input.target, verdict]), expected);
  assert.deepEqual(text.split("\n").filter((line) => /^(PASS|WARN|BLOCK) /.test(line)),
    expected.map(([kind, target, verdict]) => `${verdict.toUpperCase()} ${target} (${kind})`));
  const reasons = report.decisions.flatMap(({ reasons }) => reasons).filter(({ outcome }) => outcome !== "excepted");
  assert.deepEqual(run.results.map(({ level }) => level).sort(), reasons.map(({ outcome }) => outcome === "block" ? "error" : "warning").sort());
  if (reasons.some(({ prediction }) => prediction)) {
    assert.match(text, /\[warn\].+predicted end of life/);
    for (const result of run.results.filter(({ ruleId }) => ruleId === "release-gate.predicted-eol")) {
      assert.equal(result.level, "warning");
      const rule = run.tool.driver.rules[result.ruleIndex];
      assert(!rule.properties.offingLifecycle.endOfLifeDate);
    }
  }
  return report;
}

async function gitFixture(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: {
    ...bundled, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, ".missing-global-gitconfig"),
  } });
  git("init", "-q", "--template=");
  await writeFile(join(root, ".offing.json"), "{}\n");
  await writeFile(join(root, ".gitattributes"), "mise.toml export-ignore\n");
  for (const [version, node] of [["v1.0.0", 18], ["v2.0.0", 24]]) {
    await writeFile(join(root, "mise.toml"), `[tools]\nnode = "${node}"\n`);
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", version);
    git("tag", version);
  }
  await writeFile(join(root, "mise.toml"), '[tools]\nnode = "18"\n');
  const before = git("status", "--porcelain");
  const window = ["--today", "2025-04-01", "--within-days", "29", "--no-data", "ignore"];
  verify(root, ["release-gate", ".", ...window], [["path", ".", "block"]], 1);
  verify(root, ["release-gate", "v2.0.0", ...window], [["git-ref", "v2.0.0", "pass"]], 0);
  verify(root, ["release-gate", "v1.0.0", ...window], [["git-ref", "v1.0.0", "block"]], 1);
  const report = verify(root, ["rollback-readiness", "v2.0.0", "--candidate", "v2.0.0", "--candidate", "v1.0.0", ...window],
    [["git-ref", "v2.0.0", "pass"], ["git-ref", "v1.0.0", "block"]], 1);
  assert.equal(report.releaseRef, "v2.0.0");
  assert.equal(git("status", "--porcelain"), before);
}

async function sbomFixtures(root) {
  const { prediction } = JSON.parse(await readFile(new URL("fixtures.json", import.meta.url), "utf8"));
  const property = { name: "offing:lifecycle:predictedEol:v1", value: JSON.stringify(prediction) };
  const model = { name: "example", purl: prediction.purl };
  const component = { ...model, properties: [property] };
  const cyclonedx = (components) => ({ bomFormat: "CycloneDX", specVersion: "1.6", components });
  await writeFile(join(root, "prediction.cdx.json"), JSON.stringify(cyclonedx([component])));
  await writeFile(join(root, "invalid-annotation.cdx.json"), JSON.stringify(cyclonedx([{
    ...model, properties: [
      { ...property, name: "offing:lifecycle:endOfLifeDate" },
      { ...property, value: "{broken" },
      { ...property, value: JSON.stringify({ ...prediction, purl: "pkg:npm/example@2.0.0" }) },
      { ...property, value: JSON.stringify({ ...prediction, interval: { earliest: "2024-03-01", latest: "2024-03-01" } }) },
      { ...property, value: JSON.stringify({ ...prediction, date: "2024-02-30" }) },
      { ...property, value: JSON.stringify({ ...prediction, sources: ["file:///tmp/prediction"] }) },
    ],
  }])));
  await writeFile(join(root, "prediction.spdx.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [{
    name: model.name,
    externalRefs: [{ referenceType: "purl", referenceLocator: model.purl }],
    annotations: [{ annotator: "Tool: offing", annotationType: "OTHER", annotationDate: "2024-02-28T00:00:00Z",
      comment: `offing:predicted-eol:v1:${JSON.stringify(prediction)}` }],
  }] }));
  const forecastWindow = ["--today", "2024-02-28", "--support-until", "2024-02-29"];
  for (const mode of ["warn", "ignore", "fail"]) {
    const blocked = mode === "fail";
    const report = verify(root, ["release-gate", "--sbom", "prediction.cdx.json", ...forecastWindow, "--no-data", mode],
      [["sbom", "prediction.cdx.json", blocked ? "block" : "warn"]], blocked ? 1 : 0);
    const reasons = report.decisions[0].reasons;
    assert.deepEqual(reasons.at(-1).prediction, prediction);
    assert.equal(reasons.at(-1).outcome, "warn");
    assert(!Object.hasOwn(reasons.at(-1), "deadline"));
    assert.equal(reasons.some(({ outcome }) => outcome === "block"), blocked);
  }
  verify(root, ["release-gate", "--sbom", "prediction.spdx.json", ...forecastWindow, "--no-data", "ignore"], [["sbom", "prediction.spdx.json", "warn"]], 0);
  verify(root, ["release-gate", "--sbom", "invalid-annotation.cdx.json", ...forecastWindow, "--no-data", "ignore"], [["sbom", "invalid-annotation.cdx.json", "pass"]], 0);
  const alpine = "pkg:docker/library/alpine@3.18";
  await writeFile(join(root, "confirmed.cdx.json"), JSON.stringify(cyclonedx([{ name: "alpine", purl: alpine,
    properties: [{ ...property, value: JSON.stringify({ ...prediction, purl: alpine }) }],
  }])));
  const confirmed = verify(root, ["release-gate", "--sbom", "confirmed.cdx.json", "--today", "2026-04-01", "--within-days", "0"], [["sbom", "confirmed.cdx.json", "block"]], 1);
  assert.equal(confirmed.decisions[0].reasons[0].deadline, "2026-04-01");
  assert(!confirmed.decisions[0].reasons.some(({ prediction }) => prediction));
}

async function checkLocal() {
  const root = await mkdtemp(join(tmpdir(), "offing-packed-release-gate-"));
  try {
    await gitFixture(root);
    await sbomFixtures(root);
    for (const format of formats) {
      invoke(root, ["release-gate", "missing-ref"], format, 2);
      invoke(root, ["release-gate", "--sbom", "prediction.cdx.json"], format, 3, {
        ...bundled, OFFING_DATA_VERSION: "2099.01.01", EBB_DATA_DIR: join(root, "missing-cache"),
      });
      invoke(root, ["release-gate", "--sbom", "absent.json"], format, 4);
      invoke(root, ["release-gate", ".", "--today", "2025-02-29"], format, 4);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
  console.log("acc-release-gate: packed path, ref, CycloneDX, SPDX and rollback decisions agree in text, JSON and SARIF (exits 0–4)");
}

function checkSigned([bundle, artifact, tampered, trustedRoot, repository, workflow]) {
  assert(workflow && attestation.length === 6, "Expected six signed-fixture arguments");
  const root = process.cwd();
  const args = (subject, today) => ["release-gate", "--attestation", bundle, "--subject", subject,
    "--repo", repository, "--signer-workflow", workflow, "--trusted-root", trustedRoot, "--today", today,
    "--within-days", "0", "--no-data", "ignore"];
  verify(root, args(artifact, "2026-03-31"), [["attestation", bundle, "pass"]], 0);
  const blocked = verify(root, args(artifact, "2026-04-01"), [["attestation", bundle, "block"]], 1);
  assert(blocked.decisions[0].reasons.some(({ deadline, daysLeft, component }) => deadline === "2026-04-01" && daysLeft === 0 && component === "pkg:docker/library/alpine@3.18"));
  for (const format of formats) {
    const output = invoke(root, args(tampered, "2026-04-01"), format, 4);
    if (format === "json") {
      const rejected = JSON.parse(output);
      assert.equal(rejected.schemaVersion, "offing.error.v1");
      assert.equal(rejected.error.reason, "invalid-input");
      assert.match(rejected.error.message, /^Lifecycle attestation verification failed/);
    }
  }
  console.log("acc-release-gate: packed signature-verified decision parity passed on both sides of the deadline, and modified bytes exited 4");
}

if (attestation.length > 0) checkSigned(attestation);
else await checkLocal();
