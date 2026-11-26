import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { scanSbomFile } from "../src/sbom-scan.js";
import type { ScanResult } from "../src/domain.js";
import { SCAN_REPORTERS } from "../src/reporters.js";
import { runCli } from "./cli-runner.js";

const cd = "examples/sbom/image.cdx.json";
const spdx = "examples/sbom/repository.spdx.json";
const findingRule = "npm.package.request.deprecated";
const cli = resolve("dist/src/cli.js");

test("acc-sbom-scan: CycloneDX file and SPDX stdin report component JSON Pointers", async () => {
  const first = await runCli(["scan", "--sbom", cd, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const image = JSON.parse(first.stdout) as ScanResult;
  assert.equal(image.findings[0]?.ruleId, findingRule);
  assert.deepEqual(image.findings[0]?.location, { path: cd, jsonPointer: "/components/0" });

  const stdin = spawnSync(process.execPath, [cli, "scan", "--sbom", "-", "--json"], {
    input: await readFile(spdx),
    encoding: "utf8",
  });
  assert.equal(stdin.status, 0, stdin.stderr);
  const repo = JSON.parse(stdin.stdout) as ScanResult;
  assert.equal(repo.findings[0]?.ruleId, findingRule);
  assert.deepEqual(repo.findings[0]?.location, { path: "stdin.sbom.json", jsonPointer: "/packages/0" });
  assert.equal(repo.unclassified?.references[0]?.component, "example-repository");
  assert.equal(repo.unclassified?.references[0]?.location.jsonPointer, "/packages/1");
});

test("Syft honors explicit PURL versions, skips missing PURLs, and preserves offline provenance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-syft-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "syft.json");
  const input = JSON.stringify({
    descriptor: { name: "syft" },
    artifacts: [
      { name: "request", purl: "pkg:npm/request@2.88.2", version: "2.88.1" },
      { name: "checkout", purl: "pkg:github/actions/checkout", version: "v4" },
      { name: "unknown local component", purl: "" },
      { name: "another component" },
    ],
  });
  t.mock.method(globalThis, "fetch", async () => assert.fail("SBOM scanning must stay offline"));
  await writeFile(path, input);
  const result = await scanSbomFile(path);
  assert.deepEqual(
    result.findings.map(({ location }) => location.jsonPointer),
    ["/artifacts/1", "/artifacts/0"],
  );
  assert.deepEqual(
    result.unclassified?.references.map(({ location }) => location.jsonPointer),
    ["/artifacts/2", "/artifacts/3"],
  );
  assert.ok(result.data?.version);
  assert.equal(await readFile(path, "utf8"), input);
});

test("malformed native Syft records fail with the input pointer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-sbom-syft-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "bad.json");
  for (const [artifacts, message] of [
    [null, /artifacts must be an array/],
    [[null], /Syft \/artifacts\/0 must be an object/],
    [[{ purl: 42 }], /Syft \/artifacts\/0 purl and version must be strings/],
    [[{ purl: "pkg:npm/request", version: 42 }], /Syft \/artifacts\/0 purl and version must be strings/],
    [[{ purl: "not-a-purl" }], /Cannot check Syft \/artifacts\/0/],
  ] as const) {
    await writeFile(path, JSON.stringify({ descriptor: { name: "syft" }, artifacts }));
    await assert.rejects(scanSbomFile(path), message);
  }
  await writeFile(path, "{}");
  await assert.rejects(scanSbomFile(path), /Expected a CycloneDX/);
  await assert.rejects(scanSbomFile(root), /Expected a regular SBOM file/);
});

test("all scan reporters support SBOM and SARIF conforms with its component logical location", async (t) => {
  for (const { id } of SCAN_REPORTERS) {
    const report = await runCli(["scan", "--sbom", cd, "--format", id]);
    assert.equal(report.code, 0, id + ": " + report.stderr);
    assert.ok(report.stdout.trim(), id);
    if (id === "text") assert.match(report.stdout, /image\.cdx\.json#\/components\/0/);
  }

  const root = await mkdtemp(join(tmpdir(), "offing-sbom-sarif-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await runCli(["scan", "--sbom", spdx, "--format", "sarif"]);
  const location = JSON.parse(report.stdout).runs[0].results[0].locations[0];
  assert.equal(location.physicalLocation.artifactLocation.uri, spdx);
  assert.equal(location.logicalLocations[0].fullyQualifiedName, "/packages/0");
  const sarif = join(root, "result.sarif");
  await writeFile(sarif, report.stdout);
  const checker = spawnSync(process.execPath, ["docs/spec/sarif/conformance/check.mjs", sarif], { encoding: "utf8" });
  assert.equal(checker.status, 0, checker.stderr);
  assert.match(checker.stdout, /profile v1 passed/);
});

test("SBOM returns normal diagnostics and rejects conflicting CLI arguments", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-sbom-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = join(root, "broken.json");
  await writeFile(fixture, "{");
  const invalid = await runCli(["scan", "--sbom", fixture, "--json"]);
  assert.equal(JSON.parse(invalid.stdout).error.reason, "invalid-sbom");
  for (const args of [["--sbom"], ["--sbom", cd, "--demo"], ["--sbom", cd, "--sbom", spdx], [".", "--sbom", spdx]]) {
    const rejected = await runCli(["scan", ...args]);
    assert.equal(rejected.code, 2, JSON.stringify(args));
    assert.match(rejected.stderr, /--sbom/);
  }
  assert.equal((await runCli(["scan", "--sbom", cd, "--fail-on", "info"])).code, 1);
});

test("Action scan roots reject stdin and paths that leave through a symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-sbom-action-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(scanSbomFile("-", root, true), /requires a workspace file/);
  await assert.rejects(scanSbomFile(resolve(cd), root, true), /inside the scan root/);
  if (process.platform !== "win32") {
    await symlink(resolve(cd), join(root, "outside.json"));
    await assert.rejects(scanSbomFile("outside.json", root, true), /inside the scan root/);
  }
});
