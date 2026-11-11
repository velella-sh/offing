import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { parseDocument } from "yaml";

import { runCli } from "./cli-runner.js";

const root = resolve(import.meta.dirname, "../..");
const jenkins = await readFile(resolve(root, "integrations/jenkins/Jenkinsfile"), "utf8");
const bitbucket = await readFile(resolve(root, "integrations/bitbucket/bitbucket-pipelines.yml"), "utf8");

/** The arguments of every `offing` invocation, up to the end of the line or the closing quote. */
function invocationArguments(text: string): string[] {
  // The pinning note names a versioned package (`offing@X.Y.Z`), never an invocation.
  return [...text.matchAll(/offing(?!@)([^\n']*)/g)].map(([, args]) => args!);
}

test("the Jenkinsfile runs one Offing stage that reports before the gate can fail the build", () => {
  assert.match(jenkins, /^pipeline \{/m);
  assert.match(jenkins, /agent any/);
  assert.match(jenkins, /stages \{/);
  assert.equal([...jenkins.matchAll(/^\s*stage\(/gm)].length, 1);
  assert.match(jenkins, /stage\('Offing lifecycle scan'\)/);
  const report = jenkins.indexOf("sh 'npx --yes @velella/offing scan . --format junit > offing-report.xml || true'");
  const gate = jenkins.indexOf("sh 'npx --yes @velella/offing scan . --fail-on high'");
  assert.ok(report >= 0, "the report command is missing");
  assert.ok(gate > report, "the gate must run after the report is written");
  assert.match(jenkins, /post \{\s*always \{\s*junit 'offing-report\.xml'/);
});

test("the Bitbucket pipeline runs one Offing step that reports before it gates", () => {
  const document = parseDocument(bitbucket);
  assert.equal(document.errors.length, 0);
  const config = document.toJS() as {
    pipelines: { default: Array<{ step: { name: string; image: string; script: string[]; artifacts: string[] } }> };
  };
  assert.equal(config.pipelines.default.length, 1);
  const { step } = config.pipelines.default[0]!;
  assert.equal(step.name, "Offing lifecycle scan");
  assert.equal(step.image, "node:24");
  assert.deepEqual(step.script, [
    "npx --yes @velella/offing scan . --json > offing-report.json || true",
    "npx --yes @velella/offing scan . --fail-on high",
  ]);
  assert.deepEqual(step.artifacts, ["offing-report.json"]);
});

test("every flag the CI snippets pass appears in offing --help", async () => {
  // `--yes` is npx's own flag and precedes the package name, so only Offing's flags are collected.
  const flags = new Set(
    [jenkins, bitbucket].flatMap((text) =>
      invocationArguments(text).flatMap((args) => [...args.matchAll(/--[\w-]+/g)].map((flag) => flag[0]!)),
    ),
  );
  assert.ok(flags.size > 0);
  assert.ok(flags.has("--fail-on"));
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0, help.stderr);
  for (const flag of flags) assert.ok(help.stdout.includes(flag), `${flag} is missing from --help`);
});
