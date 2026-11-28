import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { createReplayDriver } from "../src/agent-drivers/replay.js";
import { readCampaignState } from "../src/campaign/document.js";
import {
  controlCampaign,
  localCampaign,
  readRunInputs,
  runCampaign,
  updateCampaign,
  type CampaignExecution,
} from "../src/campaign/run.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { runApprovedTest } from "../src/test-runners/run.js";
import { runCli } from "./cli-runner.js";

const exec = promisify(execFile);
const clock = Date.parse("2026-11-28T01:00:00.000Z");
const sample = resolve("docs/spec/campaign/conformance/valid-state.json");

async function folder(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "offing-campaign-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function multiBatch() {
  const state = await readCampaignState(sample);
  const template = state.repositories[0];
  assert.ok(template);
  state.batching = { size: 2, concurrency: 2, minGapMinutes: 5, maxFailureRate: 0.5 };
  state.repositories = Array.from({ length: 6 }, (_, index) => ({
    ...template,
    name: `example/repo-${index}`,
    batch: Math.floor(index / 2) + 1,
    status: "queued",
    transitions: [],
  }));
  return state;
}

test("campaigns process one bounded batch at a time and recheck elapsed time before another starts", async () => {
  const state = await multiBatch();
  const did: string[] = [];
  const snapshots: string[] = [];
  let now = clock;
  const time = () => now;
  let active = 0;
  let peak = 0;
  const save = async () => {
    snapshots.push(JSON.stringify(state));
  };
  const executor: CampaignExecution = {
    async execute(row, checkpoint) {
      active += 1;
      peak = Math.max(active, peak);
      did.push(row.name);
      await checkpoint("test12");
      active -= 1;
      return row.name.endsWith("-0") ? { status: "failed", reason: "test-failure" } : { status: "verified" };
    },
  };
  assert.equal(await runCampaign(state, executor, save, true, time), "Finished batch 1.");
  assert.deepEqual(did, ["example/repo-0", "example/repo-1"]);
  assert.equal(peak, 2);
  assert.equal(state.rollout, undefined, "one failure at the allowed fraction does not pause");
  assert.match(await runCampaign(state, executor, save, false, time), /Batch 2.*01:05:00/);
  now += 5 * 60_000;
  assert.match(await runCampaign(state, executor, save, false, time), /Batch 3.*01:10:00/);
  assert.deepEqual(did, ["example/repo-0", "example/repo-1", "example/repo-2", "example/repo-3"]);
  assert.ok(snapshots.some((entry) => /"status":"running".*"run":"test12"/.test(entry)));
  assert.deepEqual(
    state.repositories.map(({ status }) => status),
    ["failed", "verified", "verified", "verified", "queued", "queued"],
  );
});

test("a crash before the failure check cannot start the next batch; resume allows a reviewed retry", async () => {
  const state = await multiBatch();
  state.batching.maxFailureRate = 0;
  const run = () =>
    runCampaign(
      state,
      executor,
      async () => {},
      false,
      () => clock,
    );
  const started: number[] = [];
  const executor: CampaignExecution = {
    async execute(row) {
      started.push(row.batch);
      return { status: "failed", reason: "test-failure" };
    },
  };
  assert.match(await run(), /Batch 1 paused: 2\/2 failed \(limit 0\)/);
  assert.deepEqual(started, [1, 1]);
  delete state.rollout;
  delete state.checkedBatch;
  // Recreate the state saved after the last terminal repo but before the batch verdict.
  assert.match(await run(), /Batch 1 paused: 2\/2 failed/);
  assert.deepEqual(started, [1, 1]);
  controlCampaign(state, "retry", "example/repo-0", () => clock);
  assert.deepEqual(
    state.repositories.slice(0, 2).map(({ status }) => status),
    ["queued", "failed"],
  );
  assert.match(await run(), /Batch 1 paused/);
  controlCampaign(state, "resume");
  assert.match(await run(), /Batch 1 paused/);
  assert.deepEqual(started, [1, 1, 1]);
  controlCampaign(state, "cancel", undefined, () => clock);
  assert.deepEqual(
    state.repositories.map(({ status }) => status),
    Array.from({ length: 6 }, () => "cancelled"),
  );
  assert.equal(await run(), "Campaign cancelled.");
  assert.throws(() => controlCampaign(state, "resume"), /was cancelled/);
});

test("the CLI controls a saved v1 campaign and rejects a concurrent update", async (t) => {
  const root = await folder(t);
  const file = join(root, "state.json");
  const inputs = join(root, "local.json");
  const state = await multiBatch();
  await writeFile(file, JSON.stringify(state));
  await writeFile(inputs, "[]");
  const cli = (action: string, ...args: string[]) => runCli(["campaign", action, file, ...args]);
  assert.equal((await cli("pause")).code, 0);
  assert.match((await cli("run", "--inputs", inputs)).stdout, /Campaign paused/);
  assert.equal((await cli("resume", "--json")).code, 0);
  const result = await cli("run", "--inputs", inputs, "--one-batch", "--json");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /2\/2 failed/);
  assert.equal((await readCampaignState(file)).repositories[0]?.reason, "missing-local-input");
  assert.equal((await cli("retry", "--failed")).code, 0);
  assert.equal((await cli("retry", "example/repo-0")).code, 2);
  await writeFile(file + ".lock", "active");
  assert.match((await cli("resume")).stderr, /Cannot lock campaign state/);
  await rm(file + ".lock");
  assert.equal((await cli("cancel", "--json")).code, 0);
  assert.equal((await cli("run")).code, 2);
  assert.equal((await cli("status", "another")).code, 2);
  assert.equal((await cli("pause", "--one-batch")).code, 2);
});

async function preparingFixture(root: string) {
  const project = join(root, "repo");
  const workflow = "Dockerfile";
  await mkdir(project);
  await mkdir(join(project, "tests"));
  await writeFile(join(project, workflow), "FROM node:24\nMAINTAINER Fixture Team <fixture@example.invalid>\n");
  await writeFile(
    join(project, ".offing.json"),
    JSON.stringify({
      autopilot: { driver: "replay", tests: [["node", "tests/check.cjs"]], secretEnv: ["CAMPAIGN_SYNTHETIC_SECRET"] },
    }),
  );
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "campaign-fixture", scripts: { test: "node tests/check.cjs" } }),
  );
  await writeFile(
    join(project, "tests/check.cjs"),
    "const assert = require('node:assert/strict'); assert.ok(!process.env.CAMPAIGN_SYNTHETIC_SECRET);\n",
  );
  const git = async (...args: string[]) => (await exec("git", args, { cwd: project })).stdout.trim();
  await git("init", "-q");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  const commit = await git("rev-parse", "HEAD");
  const scan = await scanWithBuiltIns(project, { noCache: true });
  const finding = scan.findings.find(({ location }) => location.path === workflow);
  assert.ok(finding);
  const recording = join(root, "turns.json");
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [{ [workflow]: 'FROM node:24\nLABEL org.opencontainers.image.authors="Fixture Team"\n' }],
    }),
  );
  return { project, commit, workflow, recording, finding: finding.id, git };
}

test("a pinned local repository uses the approved Autopilot loop and reuses its recorded result", async (t) => {
  const root = await folder(t);
  const fixture = await preparingFixture(root);
  const state = await multiBatch();
  const row = state.repositories[0];
  assert.ok(row);
  state.repositories = [{ ...row, commit: fixture.commit }];
  state.batching = { size: 1, concurrency: 1, minGapMinutes: 0, maxFailureRate: 0.5 };
  const saved = join(root, "state.json");
  const input = join(root, "local.json");
  await writeFile(saved, JSON.stringify(state));
  await writeFile(
    input,
    JSON.stringify([
      {
        host: row.host,
        name: row.name,
        checkout: fixture.project,
        recording: fixture.recording,
        finding: fixture.finding,
      },
    ]),
  );
  const inputs = await readRunInputs(input);
  let tests = 0;
  const backend =
    process.env.OFFING_CAMPAIGN_DOCKER === "1"
      ? {}
      : {
          createReplay: createReplayDriver,
          async runTests() {
            tests += 1;
            return [await runApprovedTest(["node", "tests/check.cjs"], async () => ({ exitCode: 0 }), 1000)];
          },
        };
  const cli = process.env.OFFING_CAMPAIGN_CLI;
  const execute = async () => {
    if (cli) {
      const { stderr } = await exec(
        process.execPath,
        [cli, "campaign", "run", saved, "--inputs", input, "--one-batch", "--json"],
        { cwd: root, timeout: 120_000 },
      );
      return stderr.trim();
    }
    return updateCampaign(saved, async (current, save) =>
      runCampaign(current, localCampaign(current, inputs, backend), save, true),
    );
  };
  const secret = "CAMPAIGN_SYNTHETIC_SECRET";
  const marker = "synthetic-campaign-only-marker";
  const prior = process.env[secret];
  process.env[secret] = marker;
  t.after(() => {
    if (prior === undefined) delete process.env[secret];
    else process.env[secret] = prior;
  });
  const first = await execute();
  const finished = await readCampaignState(saved);
  const repo = finished.repositories[0];
  assert.ok(repo?.run);
  const evidence = join(tmpdir(), "offing-autopilot-" + repo.run);
  t.after(async () => {
    await fixture.git("worktree", "remove", "--force", join(evidence, "checkout")).catch(() => undefined);
    await rm(evidence, { force: true, recursive: true });
  });
  assert.equal(first, "Finished batch 1.", JSON.stringify(repo));
  assert.equal(repo.status, "verified");
  assert.match(await readFile(join(evidence, "checkout", fixture.workflow), "utf8"), /LABEL /);
  assert.match(await readFile(join(evidence, "final-verify-result.json"), "utf8"), /"verdict": "passed"/);
  assert.match(await readFile(join(fixture.project, fixture.workflow), "utf8"), /MAINTAINER /);
  assert.equal(await fixture.git("rev-parse", "HEAD"), fixture.commit);
  for (const file of await readdir(evidence)) {
    if (file.endsWith(".json")) assert.ok(!(await readFile(join(evidence, file), "utf8")).includes(marker), file);
  }
  const verified = structuredClone(finished);
  repo.status = "running";
  repo.transitions.pop();
  delete finished.checkedBatch;
  await writeFile(saved, JSON.stringify(finished));
  const oldTestCount = tests;
  assert.equal(await execute(), "Finished batch 1.");
  assert.equal(tests, oldTestCount, "did not repeat the verified work after an interrupted state transition");
  assert.equal((await readCampaignState(saved)).repositories[0]?.run, verified.repositories[0]?.run);
});
