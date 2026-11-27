import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { acceptsBaseline, replayLoopPrompt, testsPass } from "../src/autopilot/plan.js";
import { runReplayLoop } from "../src/autopilot/replay.js";
import { startRun } from "../src/autopilot/state.js";
import { withAutopilotWorktree } from "../src/autopilot/worktree.js";
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

async function runFixtureReplay(root: string, file: string, extra: readonly string[], docker: boolean) {
  if (docker) return runCli(["autopilot", root, "--run-replay", file, ...extra]);
  const run = startRun("prepare");
  const location = await withAutopilotWorktree(root, run, async (tree, checkout) => {
    await runReplayLoop(
      tree,
      checkout,
      run,
      {
        file,
        selection: {},
        allowedBaseline: new Set(extra.filter((arg) => arg !== "--allow-red-baseline")),
        started: performance.now(),
      },
      async (checkout, deadline) => {
        const phase = (await readFile(join(checkout, "tests/state.txt"), "utf8")).trim();
        if (phase === "runtime-unavailable") throw new Error("Unavailable fixture backend.");
        const { exitCode, xml } = reportPhase(phase);
        return [
          await runApprovedTest(
            ["node", "tests/check.cjs"],
            async () => ({ exitCode, reports: [xml] }),
            1000,
            deadline,
          ),
        ];
      },
    );
  });
  return { code: run.state === "done" ? 0 : 1, stdout: `Run record: ${location.record}\n`, stderr: "" };
}

const manifest = JSON.stringify({
  name: "loop-fixture",
  scripts: { test: "node tests/check.cjs" },
  dependencies: { request: "2.88.2" },
});
const repairedManifest = JSON.stringify({ name: "loop-fixture", scripts: { test: "node tests/check.cjs" } });

async function fixture(t: TestContext, { approveTests = true, withProfile = true, docker = useDocker } = {}) {
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
      const result = await runFixtureReplay(root, recording, extra, docker);
      const file = /Run record: ([^\r\n]+)/u.exec(result.stdout)?.[1];
      assert.ok(file, result.stderr + result.stdout);
      const tree = join(dirname(file), "checkout");
      worktrees.push(tree);
      return {
        result,
        tree,
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
  assert.equal((await runCli(["autopilot", resolve("."), "--run-replay=", "--allow-red-baseline", ""])).code, 2);
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
