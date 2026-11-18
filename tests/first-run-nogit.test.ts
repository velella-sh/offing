import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
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
