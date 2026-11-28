import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { planSchema, type Arm, type ReplayPlan } from "../benchmarks/agent-harness/contract.js";
import { runRecordedExperiment } from "../benchmarks/agent-harness/replay.js";
import { rescoreRecordedOutputs } from "../benchmarks/agent-harness/score.js";
import { loadStalenessTasks, scoreTaskDirectory } from "../benchmarks/agent-staleness/score.js";

const commit = "a".repeat(40);
const id = "manifest-package-json-cli";
const { tasks } = loadStalenessTasks();
const planInput = {
  schemaVersion: "offing.agent-replay-plan.v1",
  identity: { agent: "offline-fixture", agentVersion: "test-1", model: "fixture-v1", settings: { temperature: 0 } },
  source: "fixture",
  asOf: "2026-11-28",
  taskIds: [id],
  fixture: "gallery/nodejs",
};

async function fixtureRoot(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "offing-harness-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function put(root: string, name: string, bytes: string) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function createRecordings(root: string, plan: ReplayPlan) {
  for (const arm of plan.arms) {
    for (let attempt = 1; attempt <= plan.repeats; attempt += 1) {
      const stale = arm === "plain" && attempt <= 3;
      const packageJson = JSON.stringify({
        name: "fixture",
        ...(stale ? { dependencies: { request: "2.88.2" } } : {}),
      });
      await put(
        root,
        join(arm, id, String(attempt) + ".json"),
        JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns: [{ "package.json": packageJson }] }),
      );
    }
  }
}

function attemptPath(output: string, arm: Arm, file: string) {
  return join(output, arm, id, "1", file);
}

test("acc-agent-leaderboard: replay scores each arm, preserves model settings and injects real stack context", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected network access");
  });
  const root = await fixtureRoot(t);
  const plan = planSchema.parse(planInput);
  const recordings = join(root, "input");
  await createRecordings(recordings, plan);
  const output = join(root, "output");
  const opts = { plan, tasks, recordings, output, offingCommit: commit };
  const runs = await runRecordedExperiment(opts);
  assert.equal(runs.length, 15);
  for (const run of runs) {
    assert.equal(run.schemaVersion, "offing.agent-run.v1");
    assert.deepEqual(run.identity, plan.identity);
    assert.equal(run.pin.offingCommit, commit);
    assert.match(run.pin.ebbDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(run.status, "completed");
  }

  const plain = await readFile(attemptPath(output, "plain", "prompt.md"), "utf8");
  assert.equal(await readFile(attemptPath(output, "hooks", "prompt.md"), "utf8"), plain);
  const context = await readFile(attemptPath(output, "context", "prompt.md"), "utf8");
  assert.ok(context.startsWith(plain.trimEnd() + "\n\nStack context"));
  assert.match(context, /"schemaVersion": "offing.stack-context.v1"/);
  assert.match(context, /"asOf": "2026-11-28"/);
  assert.match(context, /"component": "nodejs",\s*"inUse": "20"/);

  const first = await rescoreRecordedOutputs([output], tasks, commit);
  assert.deepEqual(await rescoreRecordedOutputs([output], tasks, commit), first);
  assert.equal(first.attempts.length, 15);
  assert.deepEqual(
    first.arms.map(({ arm, attempts, interval95 }) => [arm, attempts, interval95]),
    [
      ["context", 5, { estimate: 0, low: 0, high: 0.4345 }],
      ["hooks", 5, { estimate: 0, low: 0, high: 0.4345 }],
      ["plain", 5, { estimate: 0.6, low: 0.2307, high: 0.8824 }],
    ],
  );

  const repeated = join(root, "again");
  await runRecordedExperiment({ ...opts, output: repeated });
  assert.equal(await readFile(attemptPath(repeated, "context", "prompt.md"), "utf8"), context);
  assert.deepEqual(await rescoreRecordedOutputs([repeated], tasks, commit), first);
  await assert.rejects(rescoreRecordedOutputs([output, repeated], tasks, commit), /Duplicate attempt/);

  const another = join(root, "different-model");
  const anotherPlan = planSchema.parse({ ...plan, identity: { ...plan.identity, model: "fixture-v2" } });
  await runRecordedExperiment({ ...opts, plan: anotherPlan, output: another });
  const combined = await rescoreRecordedOutputs([output, another], tasks, commit);
  assert.equal(combined.attempts.length, 30);
  assert.equal(combined.arms.length, 6);
  assert.deepEqual([...new Set(combined.arms.map(({ identity }) => identity.model))], ["fixture-v1", "fixture-v2"]);
});

test("overridden repeats work and invalid metadata, changed outputs and scoring pins fail", async (t) => {
  const root = await fixtureRoot(t);
  const plan = planSchema.parse({ ...planInput, arms: ["plain"], repeats: 2 });
  const recordings = join(root, "input");
  await createRecordings(recordings, plan);
  const output = join(root, "output");
  assert.equal((await runRecordedExperiment({ plan, tasks, recordings, output, offingCommit: commit })).length, 2);
  const { arms } = await rescoreRecordedOutputs([output], tasks, commit);
  assert.deepEqual(arms[0]?.interval95, { estimate: 1, low: 0.3424, high: 1 });

  const meta = attemptPath(output, "plain", "meta.json");
  const original = await readFile(meta, "utf8");
  const missingModel = original.replace('    "model": "fixture-v1",\n', "");
  await writeFile(meta, missingModel);
  await assert.rejects(rescoreRecordedOutputs([output], tasks, commit), /model/);
  await writeFile(meta, original);

  const foreignEbb = original.replace(/"ebbVersion": "[^"]+"/, '"ebbVersion": "another-snapshot"');
  await writeFile(meta, foreignEbb);
  await assert.rejects(rescoreRecordedOutputs([output], tasks, commit), /Incompatible scoring pins.*another-snapshot/);
  await writeFile(meta, original);
  await assert.rejects(rescoreRecordedOutputs([output], tasks, "b".repeat(40)), /Incompatible scoring pins/);

  await writeFile(attemptPath(output, "plain", "package.json"), "{}\n");
  await assert.rejects(rescoreRecordedOutputs([output], tasks, commit), /output digest does not match/);
  await rm(join(output, "plain", id, "2"), { recursive: true });
  await assert.rejects(rescoreRecordedOutputs([output], tasks, commit), /Incomplete replay experiment/);
});

test("an unavailable task sandbox aborts the experiment instead of falling back to static replay", async (t) => {
  const root = await fixtureRoot(t);
  const plan = planSchema.parse({ ...planInput, arms: ["plain"], repeats: 1 });
  const recordings = join(root, "input");
  await createRecordings(recordings, plan);
  const output = join(root, "output");
  const sandbox = () => Promise.reject(new Error("Fixture container unavailable"));
  await assert.rejects(
    runRecordedExperiment({ plan, tasks, recordings, output, offingCommit: commit, sandbox }),
    /Fixture container unavailable/,
  );
  await assert.rejects(readFile(join(output, "plan.json")), { code: "ENOENT" });
});

test("the offline scorer reports a stale dependency and removed API with evidence", async (t) => {
  const root = await fixtureRoot(t);
  await put(root, "package.json", '{"name":"fixture","dependencies":{"request":"2.88.2"}}');
  await put(
    root,
    "src/legacy.js",
    'import { createCipher } from "node:crypto";\ncreateCipher("legacy", "fixture"); createCipher("legacy", "fixture");\n',
  );
  const input = {
    root,
    taskId: "combined",
    category: "fixture",
    agent: "offline-fixture",
    arm: "plain" as const,
    includeEvidence: true,
  };
  const score = await scoreTaskDirectory(input);
  assert.deepEqual(score.ruleIds, ["nodejs.symbol.crypto.createcipher", "npm.package.request.deprecated"]);
  assert.equal(score.findingCount, 2);
  assert.deepEqual(
    score.findings?.map(({ origin, location, sources }) => [origin, location.path, sources.length > 0]),
    [
      ["scan", "package.json", true],
      ["snippet", "src/legacy.js", true],
    ],
  );
  assert.deepEqual(await scoreTaskDirectory(input), score);
});

test("disallowed replay paths are blocked and do not count as clean outputs", async (t) => {
  const root = await fixtureRoot(t);
  const plan = planSchema.parse({ ...planInput, arms: ["plain"], repeats: 1 });
  const recordings = join(root, "input");
  await put(
    recordings,
    join("plain", id, "1.json"),
    '{"schemaVersion":"offing.agent-replay.v1","turns":[{"outside.txt":"fixture"}]}',
  );
  const output = join(root, "output");
  const [run] = await runRecordedExperiment({ plan, tasks, recordings, output, offingCommit: commit });
  assert.equal(run?.status, "blocked");
  assert.equal(run?.outputSha256, null);
  const { arms } = await rescoreRecordedOutputs([output], tasks, commit);
  assert.equal(arms[0]?.attempts, 1);
  assert.equal(arms[0]?.completedOutputs, 0);
  assert.deepEqual(arms[0]?.interval95, { estimate: null, low: null, high: null });
});
