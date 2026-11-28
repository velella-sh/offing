import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mock, test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { createReplayDriver } from "../src/agent-drivers/replay.js";
import { acceptsBaseline, replayLoopPrompt, testsPass } from "../src/autopilot/plan.js";
import { runReplayLoopCommand } from "../src/autopilot/test-command.js";
import { createCommandContext } from "../src/commands/runtime.js";
import { buildAutopilotProof } from "../src/proof/build.js";
import { checkedAutopilotRun, checkedVerifyResult, digest } from "../src/proof/document.js";
import { runApprovedTest } from "../src/test-runners/run.js";
import { runCli } from "./cli-runner.js";

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execute("git", args, { cwd })).stdout.trim();

function reportPhase(phase: string) {
  const failed = phase !== "done";
  const name = phase === "baseline" ? "baseline-red" : "current-red";
  const message = phase === "baseline" ? "baseline assertion" : "latest assertion " + "noise".repeat(200);
  const xml =
    '<testsuite tests="1" failures="' +
    (failed ? 1 : 0) +
    '"><testcase name="' +
    name +
    '" file="tests/check.cjs">' +
    (failed ? '<failure message="' + message + '"/>' : "") +
    "</testcase></testsuite>";
  return { xml, exitCode: failed ? 1 : 0 };
}

const checkScript = `
const fs = require("node:fs");
const report = (${reportPhase.toString()})(fs.readFileSync("tests/state.txt", "utf8").trim());
fs.writeFileSync("junit.xml", report.xml);
process.exitCode = report.exitCode;
`;
const useDocker = process.env.OFFING_AUTOPILOT_LOOP_DOCKER === "1";

async function runFixtureReplay(
  root: string,
  file: string,
  extra: readonly string[],
  docker: boolean,
  runTests: typeof runFixtureTest,
) {
  const args = [root, "--run-replay", file, ...extra];
  if (docker) {
    const cli = process.env.OFFING_AUTOPILOT_LOOP_CLI;
    if (!cli) return runCli(["autopilot", ...args]);
    const execution = spawnSync(process.execPath, [cli, "autopilot", ...args], { encoding: "utf8" });
    if (execution.error) throw execution.error;
    return { code: execution.status, stdout: execution.stdout, stderr: execution.stderr };
  }
  let stdout = "";
  const write = process.stdout.write;
  const capture = mock.method(process.stdout, "write", (chunk: unknown, ...params: unknown[]) => {
    if (typeof chunk !== "string") return Reflect.apply(write, process.stdout, [chunk, ...params]);
    stdout += chunk;
    return true;
  });
  try {
    const code = await runReplayLoopCommand(args, createCommandContext(args, ""), () => ({}), {
      createReplay: createReplayDriver,
      runTests,
    });
    return { code, stdout, stderr: "" };
  } finally {
    capture.mock.restore();
  }
}

async function runFixtureTest(checkout: string, deadline: number) {
  const phase = (await readFile(join(checkout, "tests/state.txt"), "utf8")).trim();
  if (phase === "runtime-unavailable") throw new Error("Unavailable fixture backend.");
  const { exitCode, xml } = reportPhase(phase);
  return [
    await runApprovedTest(["node", "tests/check.cjs"], async () => ({ exitCode, reports: [xml] }), 1000, deadline),
  ];
}

const manifest = JSON.stringify({
  name: "loop-fixture",
  scripts: { test: "node tests/check.cjs" },
  dependencies: { request: "2.88.2" },
});
const repairedManifest = JSON.stringify({ name: "loop-fixture", scripts: { test: "node tests/check.cjs" } });

async function fixture(
  t: TestContext,
  { approveTests = true, withProfile = true, docker = useDocker, runTests = runFixtureTest } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "offing-loop-tests-"));
  const root = join(directory, "repository");
  const recording = join(directory, "turns.json");
  const worktrees: string[] = [];
  t.after(async () => {
    for (const tree of worktrees) {
      await git(root, "worktree", "remove", "--force", tree).catch(() => {});
      await rm(dirname(tree), { recursive: true, force: true });
    }
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "tests/check.cjs"), checkScript);
  await writeFile(join(root, "tests/state.txt"), "baseline\n");
  await writeFile(join(root, "Dockerfile"), "FROM node:24\nMAINTAINER Fixture Team <fixture@example.invalid>\n");
  if (withProfile) await writeFile(join(root, "package.json"), manifest + "\n");
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({
      autopilot: {
        ...(approveTests ? { tests: [["node", "tests/check.cjs"]] } : {}),
        budget: { run: { turns: 4, wallTimeMs: 120_000 } },
      },
    }),
  );
  await git(root, "init", "--quiet");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const base = await git(root, "rev-parse", "HEAD");
  return {
    root,
    base,
    async run(turns: Record<string, string>[], ...extra: string[]) {
      await writeFile(recording, JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns }));
      const result = await runFixtureReplay(root, recording, extra, docker, runTests);
      const file = /Run record: ([^\r\n]+)/u.exec(result.stdout)?.[1];
      assert.ok(file, "Run record: " + result.stderr + result.stdout);
      const tree = join(dirname(file), "checkout");
      if (!worktrees.includes(tree)) worktrees.push(tree);
      return {
        result,
        tree,
        recordFile: file,
        record: JSON.parse(await readFile(file, "utf8")),
        async evidence(name: string) {
          return JSON.parse(await readFile(join(dirname(file), name), "utf8"));
        },
      };
    },
  };
}

test("Autopilot feedback bounds large assertion messages, ignores prior attempts, and only waives listed structured failures", async () => {
  let attempt = 0;
  const report = (name: string, message: string) =>
    `<testsuite tests="1" failures="1"><testcase name="${name}" file="tests/a.js"><failure message="${message}"/></testcase></testsuite>`;
  const run = await runApprovedTest(
    ["node", "tests/a.js"],
    async () => ({
      exitCode: 1,
      reports:
        ++attempt === 1
          ? [report("old", "previous")]
          : Array.from({ length: 9 }, (_, index) =>
              report(`new-${index}`, `assertion credential ${"noise".repeat(600)}`),
            ),
    }),
    1000,
  );
  assert.equal(testsPass([run]), false);
  assert.equal(acceptsBaseline([run], new Set(["new-0"])), false);
  assert.equal(acceptsBaseline([run], new Set(Array.from({ length: 9 }, (_, i) => `new-${i}`))), true);
  const prompt = replayLoopPrompt([], [run], ["tests/a.js"], (text) => text.replaceAll("credential", "[REDACTED]"));
  assert.match(prompt, /assertion \[REDACTED\]/u);
  assert.match(prompt, /Touched: "tests\/a\.js"/u);
  assert.match(prompt, /Feedback truncated/u);
  assert.doesNotMatch(prompt, /(?:previous|new-8|credential)/u);
  assert.ok(Buffer.byteLength(prompt.split("Latest test feedback:\n")[1] ?? "") <= 8192);
});

test("acc-autopilot-loop proves the red-baseline guard, codemod receipt and two numbered commits", async (t) => {
  const project = await fixture(t);
  const turns = [
    { "tests/state.txt": "first\n" },
    { "tests/state.txt": "done\n", "package.json": repairedManifest + "\n" },
  ];
  const refused = await project.run(turns, "--allow-red-baseline", "wrong-test");
  assert.equal(refused.result.code, 1, refused.result.stdout);
  assert.equal(refused.record.stopReason, "baseline-tests-failed");
  assert.equal(await git(refused.tree, "rev-parse", "HEAD"), project.base);
  assert.match(await readFile(join(refused.tree, "Dockerfile"), "utf8"), /^MAINTAINER\b/mu);
  const undo = await runCli(["autopilot", project.root, "--undo", refused.record.checkout.id]);
  assert.match(undo.stderr, /preserved the checkout and its recorded migration evidence/u);
  assert.equal(await git(refused.tree, "rev-parse", "HEAD"), project.base);
  const accepted = await project.run(turns, "--allow-red-baseline", "baseline-red");
  const finalTests = await accepted.evidence("turn-2-tests.json");
  const history = await git(accepted.tree, "log", "--format=%s", `${project.base}..HEAD`);
  assert.equal(
    accepted.result.code,
    0,
    JSON.stringify({
      diagnostic: accepted.result.stdout + accepted.result.stderr,
      tests: finalTests,
      history,
      dockerfile: await readFile(join(accepted.tree, "Dockerfile"), "utf8"),
    }),
  );
  assert.equal(accepted.record.state, "done");
  assert.deepEqual((await git(accepted.tree, "log", "--format=%s", `${project.base}..HEAD`)).split("\n").reverse(), [
    "chore: apply Autopilot codemods",
    "chore: replay Autopilot turn 1",
    "chore: replay Autopilot turn 2",
  ]);
  const verify = await accepted.evidence("offing-verify-result.json");
  assert.equal(verify.schemaVersion, "offing.verify-result.v1");
  assert.equal(verify.before.commit, project.base);
  assert.equal(verify.after.commit, await git(accepted.tree, "rev-parse", "HEAD~2"));
  assert.match(
    await readFile(join(accepted.tree, "Dockerfile"), "utf8"),
    /^LABEL org\.opencontainers\.image\.authors=/mu,
  );
  const first = (await accepted.evidence("turn-1-prompt.json")).prompt;
  const second = (await accepted.evidence("turn-2-prompt.json")).prompt;
  assert.match(first, /npm\.package\.request\.deprecated/u);
  assert.doesNotMatch(first, /container\.dockerfile\.maintainer|MAINTAINER/u);
  assert.match(first, /baseline assertion/u);
  assert.match(second, /latest assertion/u);
  assert.match(second, /Feedback truncated/u);
  assert.match(second, /Touched: "tests\/state\.txt"/u);
  assert.doesNotMatch(second, /baseline assertion/u);
  assert.equal(await readFile(join(project.root, "package.json"), "utf8"), manifest + "\n");
  assert.equal(await git(project.root, "rev-parse", "HEAD"), project.base);
});

test("acc-autopilot-loop stops repeating the same fixture failures and diff before spending another turn", async (t) => {
  const project = await fixture(t);
  const stopped = await project.run(
    [
      { "tests/state.txt": "first\n" },
      { "tests/state.txt": "second\n" },
      { "tests/state.txt": "second\n" },
      { "tests/state.txt": "done\n" },
    ],
    "--allow-red-baseline",
    "baseline-red",
  );
  assert.equal(stopped.result.code, 1, stopped.result.stdout + stopped.result.stderr);
  assert.equal(stopped.record.stopReason, "no-progress");
  assert.match(await git(stopped.tree, "log", "-1", "--format=%s"), /turn 2/u);
  const failures = async (turn: number) =>
    (await stopped.evidence(`turn-${turn}-tests.json`))[0].attempts.at(-1).failures;
  assert.equal((await failures(1))[0].name, "current-red");
  assert.deepEqual(await failures(1), await failures(2));
  assert.deepEqual(await failures(2), await failures(3));
  assert.notEqual(
    await git(stopped.tree, "rev-parse", "HEAD~1^{tree}"),
    await git(stopped.tree, "rev-parse", "HEAD^{tree}"),
  );
  await assert.rejects(stopped.evidence("turn-4-prompt.json"), { code: "ENOENT" });
});

test("Autopilot loop rejects invalid options before creating a worktree", async () => {
  const examples = [
    ["--run-replay=", "--allow-red-baseline", ""],
    ["--run-replay", "turns.json", "--agent", "command"],
    ["--run-replay", "turns.json", "--resume", "123456", "--wave", "0"],
    ["--run-replay", "turns.json", "--resume", "123456", "--allow-red-baseline", "override"],
    ["--run-replay", "turns.json", "--resume", "invalid"],
  ];
  for (const args of examples) assert.equal((await runCli(["autopilot", resolve("."), ...args])).code, 2);
});

test("Autopilot loop requires explicit committed test approval before starting a container", async (t) => {
  const project = await fixture(t, { approveTests: false });
  const recording = join(dirname(project.root), "unapproved.json");
  await writeFile(recording, JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns: [] }));
  const result = await runCli(["autopilot", project.root, "--run-replay", recording]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /test-approval-required/u);
  const undo = await runCli(["autopilot", project.root, "--undo"]);
  assert.equal(undo.code, 0, undo.stderr);
});

test("Autopilot loop records an unavailable pinned profile before editing", async (t) => {
  const project = await fixture(t, { withProfile: false, docker: true });
  const attempted = await project.run([]);
  assert.equal(attempted.result.code, 1);
  assert.equal(attempted.record.stopReason, "container-tests-unavailable");
  assert.equal(await git(attempted.tree, "rev-parse", "HEAD"), project.base);
});

test("Autopilot loop preserves its numbered turn if the test backend becomes unavailable", async (t) => {
  const project = await fixture(t, { docker: false });
  const attempted = await project.run(
    [{ "tests/state.txt": "runtime-unavailable\n" }],
    "--allow-red-baseline",
    "baseline-red",
  );
  assert.equal(attempted.result.code, 1);
  assert.equal(attempted.record.stopReason, "container-tests-unavailable");
  assert.match(await git(attempted.tree, "log", "-1", "--format=%s"), /turn 1/u);
  assert.equal(await readFile(join(project.root, "tests/state.txt"), "utf8"), "baseline\n");
});

const greenTurn = { "tests/state.txt": "done\n", "package.json": repairedManifest + "\n" };
const redBaseline = ["--allow-red-baseline", "baseline-red"] as const;

test("acc-autopilot-loop verifies one-turn and three-turn completions and builds proof from recorded evidence", async (t) => {
  const project = await fixture(t);
  for (const turns of [[greenTurn], [{ "tests/state.txt": "first\n" }, { "tests/state.txt": "second\n" }, greenTurn]]) {
    const result = await project.run(turns, ...redBaseline);
    assert.equal(result.result.code, 0, result.result.stderr + result.result.stdout);
    assert.equal(result.record.state, "done");
    assert.equal(result.record.replay.turn, turns.length);
    const verify = await checkedVerifyResult(await result.evidence("final-verify-result.json"));
    assert.equal(verify.verdict, "passed");
    assert.equal(verify.before.commit, project.base);
    assert.equal(verify.after.commit, await git(result.tree, "rev-parse", "HEAD"));
    const logs = new Map([[digest(""), ""]]);
    const proof = await buildAutopilotProof(
      result.record,
      {
        repo: result.tree,
        verify,
        testRuns: await result.evidence(`turn-${turns.length}-tests.json`),
        agentRuns: await Promise.all(turns.map((_, index) => result.evidence(`turn-${index + 1}-agent.json`))),
        budget: { elapsedMs: result.record.replay.elapsedMs, costUsd: 0 },
        tools: { offing: "fixture", git: "fixture" },
        commandResults: [{ commandIndex: 0, testRunIndex: 0 }],
      },
      logs,
    );
    assert.equal(proof.proof.outcome, "done");
    assert.equal(proof.proof.verify.commands[0]?.status, "passed");
  }
});

test("acc-autopilot-loop keeps branches when tests never pass or lifecycle verification fails", async (t) => {
  const project = await fixture(t);
  const examples = [
    {
      edits: { "tests/state.txt": "first\n", "package.json": repairedManifest + "\n" },
      tests: "failed",
      remaining: 0,
      new: 0,
    },
    { edits: { "tests/state.txt": "done\n" }, tests: "passed", remaining: 1, new: 0 },
    {
      edits: {
        "tests/state.txt": "done\n",
        "package.json":
          JSON.stringify({ ...JSON.parse(repairedManifest), dependencies: { "left-pad": "1.3.0" } }) + "\n",
      },
      tests: "passed",
      remaining: 0,
      new: 1,
    },
  ];
  for (const example of examples) {
    const result = await project.run([example.edits], ...redBaseline);
    assert.equal(result.result.code, 1, result.result.stderr + result.result.stdout);
    assert.equal(result.record.state, "stopped");
    assert.equal(result.record.stopReason, "recording-exhausted");
    assert.equal(result.record.replay.tests, example.tests);
    assert.match(result.result.stdout, new RegExp(`stopped: turn 1;.*tests ${example.tests}`));
    assert.ok(result.result.stdout.includes(`Branch: ${result.record.checkout.branch}`));
    const verify = await checkedVerifyResult(await result.evidence("final-verify-result.json"));
    assert.equal(verify.counts.remaining, example.remaining);
    assert.equal(verify.counts.introduced, example.new);
    assert.equal(verify.after.commit, await git(result.tree, "rev-parse", "HEAD"));
  }
});

test("acc-autopilot-loop resumes the same worktree from recorded commits with cumulative budget", async (t) => {
  const project = await fixture(t);
  const stopped = await project.run([{ "tests/state.txt": "first\n" }], ...redBaseline);
  assert.equal(stopped.record.stopReason, "recording-exhausted");
  const priorHead = await git(stopped.tree, "rev-parse", "HEAD");
  await writeFile(join(stopped.tree, "tests/state.txt"), "uncommitted\n");
  await assert.rejects(
    async () => project.run([greenTurn], "--resume", stopped.record.checkout.id),
    /unchanged recorded worktree|Run record:/u,
  );
  await writeFile(join(stopped.tree, "tests/state.txt"), "first\n");
  const resumed = await project.run([greenTurn], "--resume", stopped.record.checkout.id);
  assert.equal(resumed.result.code, 0, resumed.result.stderr + resumed.result.stdout);
  assert.equal(resumed.tree, stopped.tree);
  assert.equal(await git(resumed.tree, "rev-parse", "HEAD^"), priorHead);
  assert.equal(await git(resumed.tree, "log", "-1", "--format=%s"), "chore: replay Autopilot turn 2");
  assert.deepEqual(resumed.record.replay.usage, { turns: 2, tokens: 0, costCents: 0 });
  assert.ok(resumed.record.replay.elapsedMs >= stopped.record.replay.elapsedMs);
  assert.equal(resumed.record.replay.resume, 1);
  assert.equal((await checkedAutopilotRun(resumed.record)).state, "done");
  assert.equal((await resumed.evidence("resume-1-verify-result.json")).verdict, "passed");
});

test("resuming replay does not replenish its turn budget", async (t) => {
  const project = await fixture(t, { docker: false });
  const turn = (phase: string) => ({ "tests/state.txt": phase + "\n" });
  const stopped = await project.run([turn("one"), turn("two"), turn("three")], ...redBaseline);
  assert.equal(stopped.record.stopReason, "recording-exhausted");
  const continued = await project.run([turn("four"), greenTurn], "--resume", stopped.record.checkout.id);
  assert.equal(continued.record.stopReason, "run.turns");
  assert.equal(continued.record.replay.usage.turns, 4);
  assert.equal(await git(continued.tree, "log", "-1", "--format=%s"), "chore: replay Autopilot turn 4");
  assert.equal(await readFile(join(continued.tree, "tests/state.txt"), "utf8"), "four\n");
});

test("a failed baseline backend or codemod preserves the recorded state without running agent turns", async (t) => {
  const cases = [
    { step: "baseline", reason: "container-tests-unavailable", commit: false },
    { step: "codemod", reason: "codemod-error", commit: false },
    { step: "codemod-tests", reason: "container-tests-unavailable", commit: true },
  ];
  for (const { step, reason, commit } of cases) {
    const project = await fixture(t, {
      docker: false,
      async runTests(tree, deadline) {
        const dockerfile = await readFile(join(tree, "Dockerfile"), "utf8");
        if (step === "baseline" || (step === "codemod-tests" && dockerfile.includes("LABEL"))) {
          throw new Error("Unavailable fixture backend.");
        }
        if (step === "codemod") await writeFile(join(dirname(tree), "codemods.patch"), "existing fixture patch");
        return runFixtureTest(tree, deadline);
      },
    });
    const stopped = await project.run([greenTurn], ...redBaseline);
    assert.equal(stopped.record.stopReason, reason);
    assert.equal(stopped.record.replay.turn, 0);
    assert.equal((await git(stopped.tree, "rev-parse", "HEAD")) !== project.base, commit);
  }
});

test("resume rejects invalid records, conflicting resumes, and changed policy before applying another edit", async (t) => {
  const project = await fixture(t, { docker: false });
  const stopped = await project.run([{ "tests/state.txt": "first\n" }], ...redBaseline);
  const args = ["--resume", stopped.record.checkout.id];
  const resume = () => project.run([greenTurn], ...args);
  await writeFile(stopped.recordFile, "{}", { mode: 0o600 });
  await assert.rejects(resume, /Invalid Autopilot run record/u);
  await writeFile(stopped.recordFile, JSON.stringify(stopped.record));
  const lock = join(dirname(stopped.recordFile), "resume.lock");
  await writeFile(lock, "");
  await assert.rejects(resume, /already has a resume lock/u);
  await unlink(lock);
  await writeFile(
    stopped.recordFile,
    JSON.stringify({
      ...stopped.record,
      replay: { ...stopped.record.replay, context: "0".repeat(64) },
    }),
  );
  await assert.rejects(resume, /original policy and lifecycle data/u);
  await writeFile(stopped.recordFile, JSON.stringify(stopped.record));
  const completed = await resume();
  assert.equal(completed.record.state, "done");
  await assert.rejects(resume, /stopped at the end of its recording/u);
});

test("a resumed run preserves its previous turn when the test backend becomes unavailable", async (t) => {
  let unavailable = false;
  const project = await fixture(t, {
    docker: false,
    async runTests(tree, deadline) {
      if (unavailable) throw new Error("Unavailable fixture backend.");
      return runFixtureTest(tree, deadline);
    },
  });
  const stopped = await project.run([{ "tests/state.txt": "first\n" }], ...redBaseline);
  const head = await git(stopped.tree, "rev-parse", "HEAD");
  unavailable = true;
  const result = await project.run([greenTurn], "--resume", stopped.record.checkout.id);
  assert.equal(result.record.stopReason, "container-tests-unavailable");
  assert.equal(result.record.replay.turn, 1);
  assert.equal(await git(result.tree, "rev-parse", "HEAD"), head);
});

const scoreboardCapture = process.env.OFFING_AUTOPILOT_SCOREBOARD_CAPTURE;
test("acc-autopilot-evals records real replay runs for the fixture scoreboard", {
  skip: !scoreboardCapture,
}, async (t) => {
  assert.ok(scoreboardCapture);
  const output = resolve(scoreboardCapture);
  await mkdir(output);
  const project = await fixture(t, { docker: true });
  const green = await project.run([greenTurn], ...redBaseline);
  const phases = ["first", "second", "third", "fourth"].map((value) => ({ "tests/state.txt": `${value}\n` }));
  const exhausted = await project.run([...phases, greenTurn], ...redBaseline);
  const failed = await project.run([{ "tests/state.txt": "done\n" }], ...redBaseline);
  const ineligible = await fixture(t, { withProfile: false, docker: true });
  const excluded = await ineligible.run([]);
  assert.equal(green.result.code, 0, green.result.stderr + green.result.stdout);
  assert.equal(exhausted.record.stopReason, "run.turns", exhausted.result.stderr + exhausted.result.stdout);
  assert.equal(failed.record.stopReason, "recording-exhausted");
  const excludedRun = await checkedAutopilotRun(excluded.record);
  assert.equal(excludedRun.stopReason, "container-tests-unavailable");
  const excludedTurns = excludedRun.transitions.filter((phase) => phase === "agent-turn").length;
  assert.equal(excludedTurns, 0);

  async function proofFor(result: typeof green) {
    const run = await checkedAutopilotRun(result.record);
    assert.ok(run.replay && run.replay.turn > 0);
    const turn = run.replay.turn;
    const attempted = run.transitions.filter((phase) => phase === "agent-turn").length;
    const verify = await checkedVerifyResult(await result.evidence("final-verify-result.json"));
    assert.ok(verify.after.offingVersion);
    const { proof } = await buildAutopilotProof(
      run,
      {
        repo: result.tree,
        verify,
        testRuns: await result.evidence(`turn-${turn}-tests.json`),
        agentRuns: await Promise.all(
          Array.from({ length: attempted }, (_, i) => result.evidence(`turn-${i + 1}-agent.json`)),
        ),
        budget: { elapsedMs: run.replay.elapsedMs, costUsd: run.replay.usage.costCents / 100 },
        tools: { offing: verify.after.offingVersion, git: await git(result.tree, "--version") },
        commandResults: [{ commandIndex: 0, testRunIndex: 0 }],
      },
      new Map([[digest(""), ""]]),
    );
    return { run, proof };
  }
  async function failure(file: string, lines: readonly string[]) {
    const text = `${lines.join("\n")}\n`;
    await writeFile(join(output, file), text, { flag: "wx" });
    return { file, sha256: digest(text) };
  }
  const done = await proofFor(green);
  const budget = await proofFor(exhausted);
  const unresolved = await proofFor(failed);
  assert.equal(done.proof.verify.verdict, "passed");
  const rows = [
    { id: "completed-replay", outcome: "green", ...done },
    {
      id: "turn-budget-replay",
      outcome: "stopped-by-budget",
      ...budget,
      lastFailure: await failure("exhausted.txt", [
        `Recorded stop: ${budget.run.stopReason}`,
        `Accepted replay turns: ${budget.run.replay?.usage.turns}`,
      ]),
    },
    {
      id: "unresolved-replay",
      outcome: "failed",
      ...unresolved,
      lastFailure: await failure("failed.txt", [
        `Recorded stop: ${unresolved.run.stopReason}`,
        `Verification: ${unresolved.proof.verify.verdict}`,
        `Remaining selected findings: ${unresolved.proof.verify.counts.remaining}`,
      ]),
    },
    {
      id: "missing-profile-replay",
      outcome: "excluded",
      lastFailure: await failure("excluded.txt", [
        `Recorded preflight stop: ${excludedRun.stopReason}`,
        `Recorded replay turns: ${excludedTurns}`,
      ]),
    },
  ];
  await writeFile(join(output, "results.json"), `${JSON.stringify({ source: "synthetic-fixture", rows }, null, 2)}\n`, {
    flag: "wx",
  });
});
