import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runCli } from "./cli-runner.js";
import { copyFixtureTree } from "./fixture-copies.js";

test("bare Offing scans without Git or terminal input in CI", async (t) => {
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const cwd = await copyFixtureTree("examples/demo", roots);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [resolve("dist/src/cli.js")], {
    cwd,
    env: { ...process.env, PATH: "", CI: "true", OFFING_NO_CACHE: "1" },
    timeout: 5000,
  });
  assert.equal(stderr, "");
  assert.match(stdout, /^Weather: /);
  assert.match(stdout, /Lifecycle findings: [1-9]\d*/);
  assert.match(stdout, /Git history is not available; Offing scanned the files on disk\./);
  assert.doesNotMatch(stdout, /folder is empty/);
  assert.ok(stdout.trimEnd().split("\n").length < 25);
});

test("the first-run process needs neither terminal input, write permissions, nor network connections", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "offing-first-run-preview-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, ".nvmrc"), "18\n");
  await writeFile(join(cwd, ".python-version"), "3.8\n");
  await writeFile(join(cwd, "package.json"), '{"dependencies":{"request":"2.88.2"}}\n');
  const original = (await readdir(cwd, { recursive: true })).sort();
  const guard = pathToFileURL(resolve("tests/fixtures/first-run-no-network.mjs")).href;
  const cli = resolve("dist/src/cli.js");
  const env = { ...process.env, OFFING_NO_CACHE: undefined, OFFING_CACHE_DIR: join(cwd, "unexpected-cache") };
  const preview = ["autopilot", ".", "--dry-run", "--wave", "0"];
  for (const args of [[], preview, ["--json"]]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--permission", "--allow-fs-read=*", "--allow-child-process", "--import", guard, cli, ...args],
      { cwd, env, timeout: 5000 },
    );
    if (args.length === 0) {
      assert.match(stdout, /^Weather: /);
      assert.match(stdout, /Lifecycle findings: 3;/);
      assert.ok(stdout.endsWith(`Autopilot can fix 2; run offing ${preview.join(" ")} to preview.\n`), stdout);
    } else if (args === preview) {
      assert.match(stdout, /Plan: wave 0\n/);
      assert.match(stdout, /\.nvmrc:1.+\(offline codemod\)/);
      assert.match(stdout, /\.python-version:1.+\(offline codemod\)/);
      assert.match(stdout, /request is deprecated\n/);
      assert.match(stdout, /Offline codemods: 2\n/);
    } else {
      assert.equal(typeof (JSON.parse(stdout) as { today?: unknown }).today, "string");
    }
  }
  assert.deepEqual((await readdir(cwd, { recursive: true })).sort(), original);

  const first = await runCli([], { cwd, env });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Autopilot can fix 2/);
  const single = await runCli(["autopilot", ".", "--dry-run", "--finding", "nodejs.runtime.eol-18:.nvmrc:1"], {
    cwd,
    env,
  });
  assert.equal(single.code, 0, single.stderr);
  assert.match(single.stdout, /Offline codemods: 1/);
});

test("a denied codemod patch prevents the first run from suggesting the whole wave", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "offing-first-run-denied-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, ".nvmrc"), "18\n");
  await writeFile(join(cwd, ".python-version"), "3.8\n");
  await writeFile(join(cwd, "package.json"), "{}\n");
  await writeFile(join(cwd, ".offing.json"), '{"autopilot":{"deniedPaths":[".nvmrc"]}}\n');
  const cli = resolve("dist/src/cli.js");
  const run = (args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], { cwd, timeout: 5000 });

  assert.doesNotMatch((await run([])).stdout, /Autopilot can fix/);
  assert.match((await run(["autopilot", ".", "--dry-run", "--wave", "0"])).stdout, /Offline codemods: 0/);
});
