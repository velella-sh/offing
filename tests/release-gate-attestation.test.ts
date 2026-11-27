import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import type { LifecycleStatement } from "../src/attestation/statement.js";
import type { GateReport } from "../src/release-gate/decision.js";
import { runCli } from "./cli-runner.js";

interface AttestationFixture {
  artifact: string;
  statement: LifecycleStatement;
}

const vector: AttestationFixture = JSON.parse(
  await readFile("docs/spec/lifecycle-attestation/conformance/fixtures.json", "utf8"),
);

function argsFor(root: string): string[] {
  return [
    "release-gate",
    "--attestation",
    join(root, "bundle.json"),
    "--subject",
    join(root, "artifact.bin"),
    "--repo",
    "example/service",
    "--signer-workflow",
    "example/service/.github/workflows/build.yml",
    "--trusted-root",
    join(root, "roots.jsonl"),
    "--today",
    "2024-03-01",
    "--within-days",
    "0",
    "--json",
  ];
}

test("release gate delegates to an offline verifier and evaluates only its authenticated output", {
  // Simulate the external tool's process contract; the repository has no signed lifecycle fixture yet.
  skip: process.platform === "win32",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-gate-gh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "artifact.bin"), vector.artifact);
  await writeFile(join(root, "roots.jsonl"), "{}\n");
  await writeFile(join(root, "bundle.json"), "UNAUTHENTICATED INPUT\n");
  await writeFile(
    join(root, "gh"),
    `#!${process.execPath}
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 2), ["attestation", "verify"]);
assert.match(args[2], /artifact\\.bin$/);
for (const option of ["--bundle", "--custom-trusted-root", "--deny-self-hosted-runners", "--repo", "--signer-workflow", "--predicate-type", "--jq"]) assert.ok(args.includes(option));
assert.equal(args[args.indexOf("--repo") + 1], "example/service");
assert.equal(args[args.indexOf("--signer-workflow") + 1], "example/service/.github/workflows/build.yml");
assert.equal(args[args.indexOf("--predicate-type") + 1], "https://velella.sh/offing/attestation/v1/");
const fs = require("node:fs");
const bundle = fs.readFileSync(args[args.indexOf("--bundle") + 1], "utf8");
if (!bundle.startsWith("UNAUTHENTICATED")) { console.error("signature mismatch"); process.exit(1); }
process.stdout.write(fs.readFileSync(${JSON.stringify(join(root, "verified.json"))}));
`,
    { mode: 0o700 },
  );
  const cli = () => runCli(argsFor(root), { cwd: root, env: { PATH: [root, process.env.PATH].join(delimiter) } });
  await writeFile(join(root, "verified.json"), JSON.stringify([vector.statement]));
  const valid = await cli();
  assert.equal(valid.code, 1, valid.stderr);
  const report: GateReport = JSON.parse(valid.stdout);
  const decision = report.decisions[0];
  assert.equal(decision?.input.kind, "attestation");
  assert.equal(decision?.verdict, "block");
  assert.equal(decision?.reasons.find(({ code }) => code === "lifecycle")?.daysLeft, -1);
  assert.equal(decision?.reasons.filter(({ code }) => code === "no-data").length, 2);

  await writeFile(join(root, "verified.json"), JSON.stringify([vector.statement, vector.statement]));
  assert.match((await cli()).stderr, /Expected one verified lifecycle statement/);

  await writeFile(join(root, "verified.json"), JSON.stringify([{ ...vector.statement, predicate: null }]));
  assert.match((await cli()).stderr, /Invalid lifecycle statement/);

  await writeFile(join(root, "verified.json"), JSON.stringify([vector.statement]));
  await writeFile(join(root, "artifact.bin"), "tampered artifact");
  assert.match((await cli()).stderr, /digest does not match/);

  await writeFile(join(root, "bundle.json"), JSON.stringify(vector.statement));
  const unsigned = await cli();
  assert.equal(unsigned.code, 4);
  assert.match(unsigned.stderr, /verification failed/);
});

test("release gate refuses a missing artifact or trust file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-gate-no-subject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const args = argsFor(root);
  const missingArtifact = await runCli(args, { cwd: root });
  assert.equal(missingArtifact.code, 4);
  assert.match(missingArtifact.stderr, /Cannot read subject/);
  await writeFile(join(root, "artifact.bin"), vector.artifact);
  await writeFile(join(root, "bundle.json"), JSON.stringify(vector.statement));
  const missingTrust = await runCli(args, { cwd: root });
  assert.equal(missingTrust.code, 4);
  assert.match(missingTrust.stderr, /Cannot read.+roots.jsonl/);
});
