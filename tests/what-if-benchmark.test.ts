import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { comparePrediction, readPin } from "../benchmarks/what-if/score.js";

test("what-if benchmark keeps incorrect verdicts, missed blockers, and unexpected blockers visible", () => {
  const matched = { path: "package-lock.json", subject: "matched@1.0.0" };
  const missed = { path: "package-lock.json", subject: "missed@1.0.0" };
  const unexpected = { path: "package-lock.json", subject: "unexpected@1.0.0" };
  const compared = comparePrediction(
    { verdict: "blocked", blockers: [matched, missed] },
    { verdict: "unknown", blockers: [unexpected, matched, matched] },
  );

  assert.deepEqual(compared, {
    expected: "blocked",
    actual: "unknown",
    matched: ["package-lock.json#matched@1.0.0"],
    missed: ["package-lock.json#missed@1.0.0"],
    unexpected: ["package-lock.json#unexpected@1.0.0"],
  });
});

test("what-if benchmark rejects invalid pins, missing offline inputs, and tampered cached manifest bytes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-what-if-benchmark-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('{"engines":{"node":"20"}}');
  const commit = "a".repeat(40);
  const pin = { path: "package.json", sha256: createHash("sha256").update(bytes).digest("hex") };
  const repository = "public/example";
  const copy = join(directory, commit, pin.path);

  await assert.rejects(
    readPin(repository, commit, { ...pin, path: "../package.json" }, directory, false),
    /Invalid file pin/,
  );
  await assert.rejects(readPin(repository, "main", pin, directory, true), /Invalid public source pin/);
  await assert.rejects(readPin(repository, commit, pin, directory, false), /ENOENT/);
  await mkdir(join(directory, commit));
  await writeFile(copy, bytes);
  assert.deepEqual(await readPin(repository, commit, pin, directory, false), bytes);
  await writeFile(copy, '{"engines":{"node":"22"}}');
  await assert.rejects(readPin(repository, commit, pin, directory, false), /Hash or size mismatch/);
});

test("the what-if benchmark pins at least 50 distinct pull requests with two sources of migration evidence", async () => {
  const corpus = JSON.parse(await readFile("benchmarks/what-if/corpus.json", "utf8")) as Array<{
    repository: string;
    pullRequest: number;
    witness: { path: string; before: string; after: string };
    base: { commit: string; files: { path: string; sha256: string }[] };
    merged: { commit: string; files: { path: string; sha256: string }[] };
  }>;
  const ids = corpus.map((entry) => `${entry.repository.toLowerCase()}#${entry.pullRequest}`);
  assert.ok(ids.length >= 50);
  assert.equal(new Set(ids).size, ids.length);

  for (const { witness, base, merged } of corpus) {
    assert.notEqual(witness.before, witness.after);
    assert.notEqual(base.commit, merged.commit);
    for (const snapshot of [base, merged]) {
      assert.match(snapshot.commit, /^[\da-f]{40}$/u);
      assert.ok(snapshot.files.some(({ path }) => path === witness.path));
      for (const { sha256 } of snapshot.files) assert.match(sha256, /^[\da-f]{64}$/u);
    }
  }
});
