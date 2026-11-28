import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { createReplayDriver } from "../src/agent-drivers/replay.js";
import { type CampaignState, readCampaignState } from "../src/campaign/document.js";
import type { HostPermissions, HostTarget } from "../src/campaign/host-config.js";
import {
  controlCampaign,
  localCampaign,
  readRunInputs,
  runCampaign,
  updateCampaign,
  type CampaignExecution,
} from "../src/campaign/run.js";
import { digest } from "../src/proof/document.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { runApprovedTest } from "../src/test-runners/run.js";
import { gitLoopback } from "./campaign-host-fixture.js";
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

async function preparingFixture(root: string, needsAgent = false) {
  const project = join(root, "repo");
  const workflow = "Dockerfile";
  const manifest = { name: "campaign-fixture", scripts: { test: "node tests/check.cjs" } };
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
    JSON.stringify({ ...manifest, ...(needsAgent && { dependencies: { request: "2.88.2" } }) }),
  );
  await writeFile(
    join(project, "tests/check.cjs"),
    "const assert = require('node:assert/strict'); assert.ok(!process.env.CAMPAIGN_SYNTHETIC_SECRET); assert.ok(!Object.keys(process.env).some(key => key.startsWith('OFFING_CAMPAIGN_TOKEN_')));\n",
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
  const finding = scan.findings.find(({ location, ruleId }) =>
    needsAgent ? ruleId === "npm.package.request.deprecated" : location.path === workflow,
  );
  assert.ok(finding);
  const recording = join(root, "turns.json");
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [
        needsAgent
          ? { "package.json": JSON.stringify(manifest) + "\n" }
          : { [workflow]: 'FROM node:24\nLABEL org.opencontainers.image.authors="Fixture Team"\n' },
      ],
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
          async runTests(_tree: string, _deadline: number, capture?: (text: string) => string) {
            tests += 1;
            return [
              await runApprovedTest(
                ["node", "tests/check.cjs"],
                async () => ({ exitCode: 0 }),
                1000,
                Infinity,
                capture,
              ),
            ];
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
  const secret = "OFFING_CAMPAIGN_TOKEN_GITHUB";
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

const actor = 86;
const tokenKey = "OFFING_CAMPAIGN_TOKEN_FIXTURE";
const marker = "fixture-host-header-only-synthetic-token";

function approvals(state: CampaignState): HostPermissions {
  return {
    campaign: state.id,
    repositories: state.repositories.map(({ host, name }) => ({
      host,
      name,
      actorId: actor,
      baseBranch: "main",
      tokenEnv: tokenKey,
    })),
  };
}

async function instrumentDocker(root: string, env: NodeJS.ProcessEnv) {
  const docker = (await exec("which", ["docker"])).stdout.trim();
  const bin = join(root, "shim");
  const receipt = join(root, "agent-env.txt");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    [
      "#!" + process.execPath,
      'const { spawnSync } = require("node:child_process");',
      'const { appendFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      'if (args.includes("--eval") && args.includes("--input-type=module")) {',
      '  const container = args[args.indexOf("--workdir") + 2];',
      '  const prefix = args.slice(0, args.indexOf("exec"));',
      `  const env = spawnSync(${JSON.stringify(docker)}, [...prefix, "exec", container, "env"], { encoding: "utf8" });`,
      `  if (env.status !== 0 || /^OFFING_CAMPAIGN_TOKEN_/mu.test(env.stdout) || env.stdout.includes(${JSON.stringify(marker)})) process.exit(87);`,
      `  appendFileSync(${JSON.stringify(receipt)}, "isolated\\n");`,
      "}",
      `const real = spawnSync(${JSON.stringify(docker)}, args, { stdio: "inherit" });`,
      "process.exit(real.status ?? 1);",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  env.PATH = bin + delimiter + (env.PATH ?? "");
  return receipt;
}

test("pinned local repository publishing reconciles GitHub and writes one GitLab MR through isolated Git", async (t) => {
  const root = await folder(t);
  const fixture = await preparingFixture(root, true);
  const gitlab = await gitLoopback(t, root, fixture.project, fixture.commit, marker, actor, true);
  const github = await gitLoopback(t, root, fixture.project, fixture.commit, marker + "-github", actor, false);
  const state = await multiBatch();
  const template = state.repositories[0];
  assert.ok(template);
  state.repositories = [
    { ...template, batch: 1, host: gitlab.origin, name: gitlab.repo, commit: fixture.commit },
    {
      ...template,
      batch: 2,
      host: "https://github.com",
      name: github.repo,
      commit: fixture.commit,
      transitions: [],
    },
  ];
  state.batching = { size: 1, concurrency: 1, minGapMinutes: 5, maxFailureRate: 0 };
  const saved = join(root, "state.json");
  const inputs = join(root, "inputs.json");
  const hostFile = join(root, "approval.json");
  await writeFile(saved, JSON.stringify(state));
  await writeFile(
    inputs,
    JSON.stringify(
      state.repositories.map(({ host, name }) => ({
        host,
        name,
        checkout: fixture.project,
        recording: fixture.recording,
        finding: fixture.finding,
      })),
    ),
  );
  const permissions = approvals(state);
  const ghTokenKey = tokenKey + "_GITHUB";
  const approvedGitHub = permissions.repositories[1];
  assert.ok(approvedGitHub);
  approvedGitHub.tokenEnv = ghTokenKey;
  await writeFile(hostFile, JSON.stringify(permissions));
  const env = { ...process.env, [tokenKey]: marker, [ghTokenKey]: marker + "-github" };
  const cli = process.env.OFFING_CAMPAIGN_CLI ?? resolve("dist/src/cli.js");
  const installed = async (name: "publication" | "run" | "host-git") =>
    import(pathToFileURL(join(dirname(cli), "campaign", name + ".js")).href);
  const {
    readRunInputs: readInputs,
    runCampaign: replay,
    localCampaign: local,
    updateCampaign: update,
  } = (await installed("run")) as typeof import("../src/campaign/run.js");
  const { managePublication: publish } = (await installed(
    "publication",
  )) as typeof import("../src/campaign/publication.js");
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, "campaign", ...args], { cwd: root, env, timeout: 120_000 });
  // The actual candidate CLI runs the recorded approved test in Docker on hosted Package Smoke.
  // Local runs keep that boundary hermetic with a deterministic approved-command fixture backend.
  let now = Date.now();
  const parsedInputs = await readInputs(inputs);
  const hosted = process.env.OFFING_CAMPAIGN_DOCKER === "1";
  if (hosted) {
    const isolationReceipt = await instrumentDocker(root, env);
    await run("run", saved, "--inputs", inputs, "--one-batch");
    const partial = await readCampaignState(saved);
    t.after(() => cleanRun(partial, fixture.git));
    partial.batching.minGapMinutes = 0;
    await writeFile(saved, JSON.stringify(partial));
    await run("run", saved, "--inputs", inputs, "--one-batch");
    const finished = await readCampaignState(saved);
    finished.batching.minGapMinutes = state.batching.minGapMinutes;
    await writeFile(saved, JSON.stringify(finished));
    assert.ok((await readFile(isolationReceipt, "utf8")).split(/\r?\n/u).filter(Boolean).length >= 2);
  } else {
    const backend = {
      createReplay(file: string, options: Parameters<typeof createReplayDriver>[1]) {
        assert.ok(options?.config.secretEnv.includes(tokenKey));
        return createReplayDriver(file, options);
      },
      async runTests(_tree: string, _deadline: number, capture?: (text: string) => string) {
        return [
          await runApprovedTest(
            ["node", "tests/check.cjs"],
            async (_command, output) => {
              output.stdout(Buffer.from("protected " + marker + " public test result"));
              return { exitCode: 0 };
            },
            1000,
            Infinity,
            capture,
          ),
        ];
      },
    };
    const old = process.env[tokenKey];
    process.env[tokenKey] = marker;
    try {
      for (let i = 0; i < 2; i++) {
        await update(saved, async (current, save) => {
          assert.match(
            await replay(current, local(current, parsedInputs, backend), save, true, () => now),
            /Finished batch/,
          );
        });
        now += 6 * 60_000;
      }
    } finally {
      if (old === undefined) delete process.env[tokenKey];
      else process.env[tokenKey] = old;
    }
  }
  const green = await readCampaignState(saved);
  t.after(() => cleanRun(green, fixture.git));
  assert.deepEqual(
    green.repositories.map(({ status }) => status),
    ["verified", "verified"],
  );
  now = Date.now() + 60 * 60_000;
  const wait: number[] = [];
  const options = {
    env,
    now: () => now,
    wait: async (ms: number) => {
      wait.push(ms);
      now += ms;
    },
    request: ((url, init) =>
      new URL(String(url)).hostname === "api.github.com"
        ? github.request(url, init)
        : fetch(url, init)) as typeof fetch,
    async push(target: HostTarget, checkout: string, pin: string, head: string, branch: string) {
      const { createCampaignBranch } = (await installed("host-git")) as typeof import("../src/campaign/host-git.js");
      const origin = target.gitlab ? target.origin : new URL(github.origin + "/");
      await createCampaignBranch({ ...target, origin }, checkout, pin, head, branch);
    },
  };
  const command = (action: "publish" | "refresh" | "cancel", oneBatch = false) =>
    update(saved, (current, save) => publish(action, current, permissions, save, oneBatch, options));
  const firstRow = green.repositories[0];
  assert.ok(firstRow);
  const occupied =
    "refs/heads/offing-campaign/" + digest(JSON.stringify([green.id, firstRow.host, firstRow.name])).slice(0, 32);
  const alienApproval = structuredClone(permissions);
  alienApproval.repositories[0]!.actorId = 52;
  await assert.rejects(
    update(saved, (current, save) => publish("publish", current, alienApproval, save, true, options)),
    /approved actor/,
  );
  gitlab.flags.protected = false;
  gitlab.branches.set("main", "9".repeat(40));
  await assert.rejects(command("publish"), /default branch differs from the approved pin/);
  assert.deepEqual(gitlab.counts, { create: 0, close: 0, push: 0, limited: 0 });
  gitlab.branches.set("main", fixture.commit);
  await gitlab.git("update-ref", occupied, fixture.commit);
  await assert.rejects(command("publish"), /already exists/);
  assert.equal((await readCampaignState(saved)).repositories[0]?.publication, undefined);
  assert.equal(await gitlab.git("rev-parse", occupied), fixture.commit);
  await gitlab.git("update-ref", "-d", occupied);
  gitlab.flags.rateLimit = true;
  gitlab.flags.loseCreatedResponse = true;
  await assert.rejects(command("publish", true), /HTTP 502/);
  const gitlabPending = (await readCampaignState(saved)).repositories[0];
  assert.equal(gitlabPending?.status, "verified");
  assert.ok(gitlabPending?.publication);
  assert.equal(gitlabPending.publication.number, undefined);
  assert.equal(await command("publish", true), "Published batch 1.");
  assert.equal(github.counts.push, 0);
  assert.equal(gitlab.counts.push, 1);
  assert.deepEqual(wait, [2000]);
  // The staged pin is unchanged and the clean clone obtained the exact verified commit.
  const first = gitlab.reviews[0];
  assert.ok(first);
  assert.equal(await gitlab.git("rev-parse", "refs/heads/" + first.branch), first.head);
  assert.ok(!JSON.parse(await gitlab.git("show", first.head + ":package.json")).dependencies);
  assert.ok(!first.branch.includes(marker));
  assert.ok(!(await gitlab.git("log", "--format=raw", "--patch", fixture.commit + ".." + first.head)).includes(marker));
  const fenced = first.body.match(/```json\n([^\n]+)\n```/u);
  assert.ok(fenced?.[1]);
  const bundle = JSON.parse(fenced[1]);
  assert.ok(Object.keys(bundle).some((file) => file.startsWith("offing-log-")));
  assert.ok(!first.body.includes(marker));
  assert.ok(!JSON.stringify(green).includes(marker));
  assert.equal(
    digest(JSON.stringify(bundle)),
    (await readCampaignState(saved)).repositories[0]?.publication?.proofSha256,
  );
  const proof = JSON.parse(bundle["offing-proof.json"]);
  assert.equal(proof.range.head, first.head);
  assert.equal(proof.agentRuns.length, 1, "exercised the actual campaign replay driver");
  const proofDirectory = join(root, "proof");
  await mkdir(proofDirectory);
  for (const [name, bytes] of Object.entries(bundle)) {
    assert.ok(typeof bytes === "string");
    await writeFile(join(proofDirectory, name), bytes);
  }
  const verifiedProof = await exec(
    process.execPath,
    [
      cli,
      "proof",
      "verify",
      join(proofDirectory, "offing-proof.json"),
      "--repo",
      join(root, "forge", gitlab.repo + ".git"),
    ],
    { cwd: root, env },
  );
  assert.match(verifiedProof.stdout, /Proof verified against local Git and log evidence/);
  assert.match((await command("publish")) ?? "", /Batch 2 can publish after/);
  now += 5 * 60_000;
  github.flags.loseCreatedResponse = true;
  github.flags.rateLimit = true;
  await assert.rejects(command("publish"), /could not be reached/);
  const checkpoint = (await readCampaignState(saved)).repositories[1];
  assert.equal(checkpoint?.status, "verified");
  assert.ok(checkpoint?.publication);
  assert.equal(checkpoint?.publication.number, undefined);
  assert.equal(github.counts.create, 1);
  assert.deepEqual(wait, [2000, 2000]);
  assert.equal(await command("publish"), "Published batch 2.");
  assert.equal(github.counts.push, 1);
  assert.equal(github.counts.create, 1);
  assert.equal(gitlab.counts.create, 1);
  const recovered = (await readCampaignState(saved)).repositories[1];
  assert.equal(recovered?.run, checkpoint.run);
  assert.equal(recovered?.publication?.proofSha256, checkpoint.publication.proofSha256);
  assert.equal(recovered?.publication?.number, 18);
  assert.deepEqual(
    recovered?.transitions.map(({ to }) => to),
    ["running", "verified", "review"],
  );
  await command("refresh");
  const observed = await readCampaignState(saved);
  assert.deepEqual(
    observed.repositories.map(({ publication }) => publication?.observed?.checks),
    ["passed", "passed"],
  );
  assert.deepEqual(
    observed.repositories.map(({ publication }) => publication?.observed?.review),
    ["approved", "approved"],
  );
  assert.match((await run("status", saved)).stdout, /Review: http:\/\/127\.0\.0\.1/);
  const onlyGitLab = { ...permissions, repositories: permissions.repositories.slice(0, 1) };
  await writeFile(hostFile, JSON.stringify(onlyGitLab));
  await run("refresh", saved, "--hosts", hostFile);
  const second = github.reviews[0];
  assert.ok(second);
  const beforeTerminalRefresh = await readFile(saved, "utf8");
  first.status = "merged";
  second.status = "closed";
  await command("refresh");
  const terminal = await readCampaignState(saved);
  assert.deepEqual(
    terminal.repositories.map(({ status }) => status),
    ["merged", "closed"],
  );
  assert.ok(
    terminal.repositories.every(({ publication }) => publication?.observed?.at === new Date(now).toISOString()),
  );
  await writeFile(saved, beforeTerminalRefresh);
  first.status = "review";
  second.status = "merged";
  first.body += "\nHuman edit";
  await assert.rejects(command("cancel"), /ownership, verified head or proof changed/);
  assert.deepEqual([gitlab.counts.close, github.counts.close], [0, 0]);
  first.body = first.body.replace(/\nHuman edit$/u, "");
  await command("cancel");
  await command("cancel");
  assert.deepEqual([gitlab.counts.close, github.counts.close], [1, 0]);
  assert.deepEqual(
    (await readCampaignState(saved)).repositories.map(({ status }) => status),
    ["closed", "merged"],
  );
  assert.equal(await gitlab.git("rev-parse", "refs/heads/" + first.branch), first.head);
});

async function cleanRun(state: CampaignState, git: (...argv: string[]) => Promise<string>) {
  for (const row of state.repositories) {
    if (!row.run) continue;
    const directory = join(tmpdir(), "offing-autopilot-" + row.run);
    await git("worktree", "remove", "--force", join(directory, "checkout")).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

test("campaign operations issue upserts one owned private tracker from durable state", async () => {
  const cli = process.env.OFFING_CAMPAIGN_CLI ?? resolve("dist/src/cli.js");
  const { trackCampaign } = (await import(
    pathToFileURL(join(dirname(cli), "campaign/tracking.js")).href
  )) as typeof import("../src/campaign/tracking.js");
  const state = await readCampaignState(sample);
  const row = state.repositories[0];
  assert.ok(row);
  const base = Date.parse("2026-11-28T01:00:00.000Z");
  let number = 15;
  let writes = 0;
  let inaccessible = true;
  const reports: { number: number; user: { id: number }; state: "open"; body: string }[] = [];
  const scope = { campaign: state.id, repository: "example/operations", actorId: actor, tokenEnv: tokenKey };
  const request = (async (value: string | URL, init?: RequestInit) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + marker);
    assert.ok(!String(init?.body).includes(marker));
    if (url.pathname === "/user") return Response.json({ id: actor });
    if (url.pathname === "/repos/example/operations") {
      return Response.json({ full_name: scope.repository, private: !inaccessible, has_issues: true });
    }
    if (init?.method === "POST") {
      writes++;
      const body: string = JSON.parse(String(init.body)).body;
      const created = { number: ++number, user: { id: actor }, state: "open", body } as const;
      reports.push(created);
      return Response.json(created);
    }
    if (init?.method === "PATCH") {
      const report = reports[0];
      assert.ok(report);
      assert.equal(url.pathname, "/repos/example/operations/issues/" + report.number);
      writes++;
      report.body = JSON.parse(String(init.body)).body;
      return Response.json(report);
    }
    const human = reports.map((report) => ({ ...report, number: 198, user: { id: 198 } }));
    return Response.json([...human, ...reports]);
  }) as typeof fetch;
  const run = () => trackCampaign(state, scope, { env: { [tokenKey]: marker }, request });
  await assert.rejects(run, /required fields/);
  assert.equal(writes, 0);
  inaccessible = false;
  assert.equal(await run(), "https://github.com/example/operations/issues/16");
  assert.equal(await run(), "https://github.com/example/operations/issues/16");
  assert.equal(writes, 1);
  row.status = "review";
  row.transitions = [
    { from: "queued", to: "running", at: new Date(base - 2).toISOString() },
    { from: "running", to: "verified", at: new Date(base - 1).toISOString() },
    { from: "verified", to: "review", at: new Date(base).toISOString() },
  ];
  row.publication = {
    branch: "offing-campaign/" + "a".repeat(32),
    baseBranch: "main",
    actorId: actor,
    head: "b".repeat(40),
    proofSha256: "a".repeat(64),
    bodySha256: "b".repeat(64),
    number: 42,
  };
  assert.equal(await run(), "https://github.com/example/operations/issues/16");
  assert.equal(reports.length, 1);
  assert.equal(writes, 2);
  const body = reports[0]?.body ?? "";
  assert.match(body, /review · 1/u);
  assert.ok(body.includes(row.host + "/" + row.name + "/pull/42"));
  assert.ok(body.includes(new Date(base).toISOString()));
});
