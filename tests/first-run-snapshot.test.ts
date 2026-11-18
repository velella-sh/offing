import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { runCli } from "./cli-runner.js";
import { copyFixtureTree } from "./fixture-copies.js";

const asOf = ["--as-of", "2026-10-25"];
const nextSteps = /\nNext: offing forecast\nNext: offing init --hooks\n$/;

test("the first-run forecast is short and stable on three examples", async (t) => {
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const outputs: string[] = [];
  for (const name of ["demo", "gallery/container", "gallery/python"]) {
    const cwd = await copyFixtureTree(`examples/${name}`, roots);
    const result = await runCli(asOf, { cwd });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, nextSteps);
    assert.ok(result.stdout.trimEnd().split("\n").length < 25);
    outputs.push(`=== examples/${name} ===\n${result.stdout}`);
  }
  const snapshot = "tests/__snapshots__/first-run-examples.txt";
  if (process.env.UPDATE_GOLDEN === "1") await writeFile(snapshot, outputs.join("\n"));
  assert.equal(outputs.join("\n"), await readFile(snapshot, "utf8"));
});

test("first-run JSON is exactly forecast JSON, with no onboarding copy", async (t) => {
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const cwd = await copyFixtureTree("examples/demo", roots);
  const current = await runCli(["--json", ...asOf], { cwd });
  assert.equal(current.code, 0, current.stderr);
  assert.deepEqual(current, await runCli(["forecast", "--json", ...asOf], { cwd }));
  assert.doesNotMatch(current.stdout, nextSteps);
});

test("first-run rejects invalid options and still honors explicit help", async () => {
  assert.match((await runCli(["--as-of"])).stderr, /Usage: offing/);
  const invalid = await runCli(["--as-of", "2026-02-30"]);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /must be a date/);
  assert.match((await runCli(["--help"])).stdout, /Usage:/);
});

test("first-run omits the no-history message when Git has a commit", async (t) => {
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const cwd = await copyFixtureTree("examples/demo", roots);
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Offing",
      "-c",
      "user.email=offing@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${cwd}/missing-hooks`,
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Initial commit",
    ],
    { cwd },
  );
  const result = await runCli(asOf, { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, nextSteps);
  assert.doesNotMatch(result.stdout, /Git history is not available/);
});
