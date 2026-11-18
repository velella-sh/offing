import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "./cli-runner.js";

test("bare Offing explains what to scan and how to try a demo in an empty folder", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "offing-first-run-empty-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const result = await runCli([], { cwd, env: { OFFING_NO_CACHE: "1" } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Weather: clear\nForecast:/);
  assert.match(result.stdout, /This folder is empty\. Offing looks for manifests, lockfiles, and CI workflows\./);
  assert.match(result.stdout, /Try the demo: https:\/\/.*QUICKSTART\.md#try-the-demo/);
});
