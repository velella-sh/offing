import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const fixture = "tests/fixtures/agent-leaderboard";
const input = join(fixture, "recorded");
const expected = join(fixture, "expected.json");

function leaderboard(...args: string[]) {
  return spawnSync(process.execPath, ["dist/benchmarks/agent-harness/leaderboard.js", ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("acc-agent-leaderboard: rescoring matches committed fixture bytes and fails on deliberate drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-leaderboard-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const committed = leaderboard("--check-committed");
  assert.equal(committed.status, 0, committed.stderr);
  assert.match(committed.stdout, /verified fixture data/);
  const snapshot = await readFile(expected);
  const fixtureArgs = ["--fixture", "--input", input, "--output"];
  for (const filename of ["first.json", "second.json"]) {
    const path = join(root, filename);
    const fresh = leaderboard(...fixtureArgs, path);
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.deepEqual(await readFile(path), snapshot);
  }
  const altered = join(root, "drift.json");
  await writeFile(altered, Buffer.concat([snapshot, Buffer.from("\n")]));
  const drifted = leaderboard(...fixtureArgs, altered, "--check");
  assert.equal(drifted.status, 1, drifted.stderr);
  assert.match(drifted.stderr, /does not match the fresh offline rescore/);
});

test("the leaderboard keeps fixture inputs and outputs out of the published data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-leaderboard-fixture-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "should-not-exist.json");
  const measured = leaderboard("--input", input, "--output", destination);
  assert.equal(measured.status, 1, measured.stderr);
  assert.match(measured.stderr, /requires recorded provenance/);
  await assert.rejects(readFile(destination), { code: "ENOENT" });
  const publicData = leaderboard(
    "--fixture",
    "--input",
    input,
    "--output",
    "docs/_data/agent-leaderboard.json",
    "--check",
  );
  assert.equal(publicData.status, 1, publicData.stderr);
  assert.match(publicData.stderr, /must stay outside the published docs directory/);
});
