import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
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
  const roots: string[] = [];
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const cwd = await copyFixtureTree("examples/demo", roots);
  const original = (await readdir(cwd, { recursive: true })).sort();
  const guard = pathToFileURL(resolve("tests/fixtures/first-run-no-network.mjs")).href;
  const cli = resolve("dist/src/cli.js");
  const env = { ...process.env, OFFING_NO_CACHE: undefined, OFFING_CACHE_DIR: join(cwd, "unexpected-cache") };
  for (const args of [[], ["--json"]]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--permission", "--allow-fs-read=*", "--allow-child-process", "--import", guard, cli, ...args],
      { cwd, env, timeout: 5000 },
    );
    if (args.length === 0) assert.match(stdout, /^Weather: /);
    else assert.equal(typeof (JSON.parse(stdout) as { today?: unknown }).today, "string");
  }
  assert.deepEqual((await readdir(cwd, { recursive: true })).sort(), original);
});
