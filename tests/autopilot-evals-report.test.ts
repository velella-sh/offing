import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import { digest } from "../src/proof/document.js";

const fixture = resolve("tests/fixtures/autopilot-evals");
const program = fileURLToPath(new URL("../benchmarks/autopilot-evals/report.js", import.meta.url));

function run(result: string) {
  return spawnSync(process.execPath, ["--permission", "--allow-fs-read=*", program, "--fixture", result], {
    encoding: "utf8",
  });
}

async function copyFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "offing-evaluation-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(fixture, directory, { recursive: true });
  return join(directory, "results.json");
}

test("recalculates fixture rates and medians and reports each non-green failure link", async () => {
  const { status, stdout, stderr } = run(join(fixture, "results.json"));
  assert.equal(status, 0, stderr);
  const outcomes = [
    ["exhausted-case", "stopped-by-budget", "exhausted.txt"],
    ["failed-case", "failed", "failed.txt"],
    ["excluded-case", "excluded", "excluded.txt"],
  ] as const;
  const nonGreen = await Promise.all(
    outcomes.map(async ([id, outcome, file]) => ({
      id,
      outcome,
      lastFailure: { file, sha256: digest(await readFile(join(fixture, file))) },
    })),
  );
  assert.deepEqual(JSON.parse(stdout), {
    source: "synthetic-fixture",
    total: 4,
    counts: { green: 1, "stopped-by-budget": 1, excluded: 1, failed: 1 },
    rates: { green: 0.25, "stopped-by-budget": 0.25, excluded: 0.25, failed: 0.25 },
    turns: { samples: 2, median: 4 },
    elapsedMs: { samples: 3, median: 3000 },
    costUsd: { samples: 2, median: 0.05 },
    nonGreen,
  });
  assert.equal(run(join(fixture, "results.json")).stdout, stdout);
});

test("rejects live labels, dry-run success, contradictory evidence, and escaped failure paths", async (t) => {
  const path = await copyFixture(t);
  const original = await readFile(path, "utf8");
  for (const [before, after, message] of [
    ['"source": "synthetic-fixture"', '"source": "live"', /Expected a synthetic/],
    ['"mode": "prepare"', '"mode": "dry-run"', /does not match the attempted/],
    ['"state": "done"', '"state": "tests"', /Last Autopilot phase disagrees/],
    ['"stopReason": "run.turns"', '"stopReason": "test-failed"', /outcome disagrees/],
    ['"schemaVersion": "offing.proof.v1"', '"schemaVersion": "unrecognized"', /Invalid proof schema/],
    ['"file": "exhausted.txt"', '"file": "../exhausted.txt"', /Expected a synthetic/],
    ['"id": "failed-case"', '"id": "green-case"', /Duplicate fixture case/],
  ] as const) {
    await writeFile(path, original.replace(before, after));
    const result = run(path);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
  }
});

test("rejects tampered failure evidence instead of printing a partial report", async (t) => {
  const path = await copyFixture(t);
  await writeFile(join(dirname(path), "failed.txt"), "modified log\n");
  const result = run(path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Last failure log hash disagrees for failed-case/);
  assert.equal(result.stdout, "");
});
