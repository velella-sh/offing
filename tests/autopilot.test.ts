import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";

import { advanceRun, startRun, type AutopilotRun } from "../src/autopilot/state.js";
import type { Plan } from "../src/plan.js";
import { runCli } from "./cli-runner.js";

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execute("git", args, { cwd })).stdout.trim();

async function repository(t: TestContext, withGit = true) {
  const directory = await mkdtemp(join(tmpdir(), "offing-autopilot-fixture-"));
  const root = join(directory, process.platform === "win32" ? "repo with spaces" : "repo with trailing space ");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(root);
  if (withGit) await git(root, "init", "--quiet");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "autopilot-fixture",
      dependencies: { request: "2.88.2", "left-pad": "1.3.0" },
      scripts: { test: "node must-not-run.js" },
    }),
  );
  if (withGit) {
    await writeFile(join(root, ".gitattributes"), "package.json filter=autopilot-fixture\n");
    await git(root, "add", ".");
    await git(
      root,
      "-c",
      "user.name=Offing Test",
      "-c",
      "user.email=offing@example.com",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "-qm",
      "fixture",
    );
  }
  return root;
}

const autopilot = (root: string, ...args: string[]) => runCli(["autopilot", root, ...args]);

test("container tests require explicit test-only intent and a selected runtime", async (t) => {
  const root = await repository(t);
  for (const args of [["--container"], ["--prepare", "--container"], ["--test-only", "--dry-run"]]) {
    const result = await autopilot(root, ...args);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /Usage: offing autopilot .*--test-only/);
  }
  const noRuntime = await autopilot(root, "--test-only");
  assert.equal(noRuntime.code, 2, noRuntime.stderr);
  assert.match(noRuntime.stderr, /Use --container or configure autopilot\.testRuntime/);
  assert.equal(await git(root, "branch", "--list", "offing/autopilot/*"), "");
  await writeFile(join(root, "uncommitted.txt"), "outside the approved snapshot");
  const dirty = await autopilot(root, "--test-only", "--container");
  assert.equal(dirty.code, 2, dirty.stderr);
  assert.match(dirty.stderr, /requires a clean working tree/);
});

function recordPath(output: string): string {
  const path = /Run record: ([^\r\n]+)/.exec(output)?.[1];
  assert.ok(path, output);
  return path;
}

async function prepare(t: TestContext, root: string, ...args: string[]) {
  const result = await autopilot(root, "--prepare", ...args);
  assert.equal(result.code, 0, result.stderr);
  const record = recordPath(result.stdout);
  t.after(async () => {
    if (await readFile(record).catch(() => undefined)) {
      const cleanup = await autopilot(root, "--undo");
      assert.equal(cleanup.code, 0, cleanup.stderr);
    }
  });
  const contents = JSON.parse(await readFile(record, "utf8")) as AutopilotRun;
  assert.ok(contents.checkout);
  return { record, run: contents, checkout: contents.checkout, worktree: join(dirname(record), "checkout") };
}

test("the phase machine records retries, stops and verification before completion", () => {
  const run = startRun("prepare");
  assert.throws(() => advanceRun(run, "done"), /Invalid Autopilot transition/);
  for (const phase of [
    "plan",
    "baseline-tests",
    "codemods",
    "agent-turn",
    "tests",
    "agent-turn",
    "tests",
    "verify",
    "done",
  ] as const) {
    advanceRun(run, phase);
  }
  assert.deepEqual(run.transitions, [
    "scan",
    "plan",
    "baseline-tests",
    "codemods",
    "agent-turn",
    "tests",
    "agent-turn",
    "tests",
    "verify",
    "done",
  ]);
  assert.throws(() => advanceRun(run, { stop: "unexpected" }), /Invalid Autopilot transition/);
});

test("dry run reports the real first wave, selected wave, exact finding and runtime target without Git or tests", async (t) => {
  const root = await repository(t, false);
  const plan = await runCli(["plan", root, "--json"]);
  assert.equal(plan.code, 0, plan.stderr);
  const { waves } = JSON.parse(plan.stdout) as Plan;
  const first = waves[0]?.itemIds[0];
  const second = waves[1]?.itemIds[0];
  assert.ok(first && second);
  const preview = await runCli(["autopilot", root, "--dry-run", "--to", "node@22", "--agent", "replay"], {
    env: { PATH: "" },
  });
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /Plan: wave 0/);
  assert.match(preview.stdout, /Upgrade target: nodejs@22/);
  assert.match(preview.stdout, /\["npm","run","test"\]/);
  assert.match(preview.stdout, /First prompt preview/);
  assert.ok(preview.stdout.includes(first));
  assert.ok(!preview.stdout.includes(second));
  for (const options of [
    ["--wave", "1"],
    ["--finding", second],
  ]) {
    const selected = await autopilot(root, "--dry-run", ...options);
    assert.equal(selected.code, 0, selected.stderr);
    assert.ok(selected.stdout.includes(second));
    assert.ok(!selected.stdout.includes(first));
  }
});

test("a configured dry run previews argv and redacts configured secret values", async (t) => {
  const root = await repository(t, false);
  const secret = 'fixture-private-"setting"';
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({
      autopilot: { driver: "codex", tests: [["fixture-test", secret]], secretEnv: ["FIXTURE_PRIVATE"] },
    }),
  );
  const result = await runCli(["autopilot", root, "--dry-run"], { env: { FIXTURE_PRIVATE: secret } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /driver: codex/);
  assert.match(result.stdout, /\["fixture-test","\[REDACTED\]"\]/);
  assert.ok(!result.stdout.includes(JSON.stringify(secret).slice(1, -1)));
  assert.doesNotMatch(result.stdout, /\["npm","run","test"\]/);
});

test("preparation uses clean HEAD, disables checkout hooks and filters, and writes a schema-valid stop", async (t) => {
  const root = await repository(t);
  const head = await git(root, "rev-parse", "HEAD");
  const originalBranch = await git(root, "branch", "--show-current");
  await git(root, "config", "filter.autopilot-fixture.smudge", "git config autopilot.filterRan true");
  const hooks = join(root, ".git", "hooks");
  await mkdir(hooks, { recursive: true });
  await writeFile(join(hooks, "post-checkout"), "#!/bin/sh\ngit config autopilot.hookRan true\n", { mode: 0o755 });
  await git(root, "config", "core.hooksPath", hooks);
  const { record, run, checkout, worktree } = await prepare(t, root, "--to", "nodejs@22");
  const ajv = new Ajv2020({ strict: false });
  const schema = JSON.parse(await readFile("schemas/autopilot-run.v1.schema.json", "utf8")) as object;
  const validate = ajv.compile(schema);
  assert.ok(validate(run), JSON.stringify(validate.errors));
  assert.equal(run.state, "stopped");
  assert.equal(run.stopReason, "isolated-test-runner-unavailable");
  assert.deepEqual(run.transitions, ["scan", "plan", "baseline-tests", "stopped"]);
  assert.deepEqual(run.selection?.target, { runtime: "nodejs", version: "22" });
  assert.equal(checkout.baseCommit, head);
  assert.equal(await git(root, "branch", "--show-current"), originalBranch);
  assert.equal(await git(root, "status", "--porcelain"), "");
  assert.equal(await git(worktree, "branch", "--show-current"), checkout.branch);
  assert.equal(await git(worktree, "rev-parse", "HEAD"), head);
  await assert.rejects(git(root, "config", "--get", "autopilot.filterRan"));
  await assert.rejects(git(root, "config", "--get", "autopilot.hookRan"));
  assert.equal((await autopilot(root, "--undo", checkout.id)).code, 0);
  await assert.rejects(readFile(record), { code: "ENOENT" });
  await assert.rejects(git(root, "rev-parse", "--verify", checkout.branch));
});

test("prepare and undo preserve an original dirty checkout and a dirty prepared checkout", async (t) => {
  const root = await repository(t);
  const originalEdit = join(root, "local.txt");
  await writeFile(originalEdit, "original");
  const dirty = await autopilot(root, "--prepare");
  assert.equal(dirty.code, 2, dirty.stderr);
  assert.match(dirty.stderr, /clean working tree/);
  assert.equal(await git(root, "branch", "--list", "offing/autopilot/*"), "");
  await rm(originalEdit);
  const { checkout, worktree } = await prepare(t, root);
  const edit = join(worktree, "local.txt");
  await writeFile(edit, "prepared");
  const undo = await autopilot(root, "--undo");
  assert.equal(undo.code, 2, undo.stderr);
  assert.match(undo.stderr, /local changes/);
  assert.equal(await readFile(edit, "utf8"), "prepared");
  await rm(edit);
  await git(
    worktree,
    "-c",
    "user.name=Offing Test",
    "-c",
    "user.email=offing@example.com",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "user work",
  );
  const advanced = await git(worktree, "rev-parse", "HEAD");
  const refused = await autopilot(root, "--undo");
  assert.equal(refused.code, 2, refused.stderr);
  assert.match(refused.stderr, /advanced prepared run/);
  assert.equal(await git(root, "rev-parse", checkout.branch), advanced);
  await git(worktree, "reset", "--hard", checkout.baseCommit);
  assert.equal((await autopilot(root, "--undo")).code, 0);
});

test("invalid requests leave no worktree, and an empty plan prints no command or prompt", async (t) => {
  const root = await repository(t);
  for (const [args, code] of [
    [[], 2],
    [["--prepare", "--dry-run"], 2],
    [["--dry-run", "--replay", "recording.json"], 2],
    [["--prepare", "--replay="], 2],
    [["--prepare", "--wave", "-1"], 2],
    [["--prepare", "--wave=-1"], 2],
    [["--prepare", "--wave", "900"], 2],
    [["--prepare", "--finding", "unseen"], 3],
    [["--dry-run", "--wave", "0", "--finding", "unseen"], 2],
    [["--dry-run", "--finding", ""], 2],
    [["--dry-run", "--to", "invalid"], 2],
    [["--undo", "--to", "nodejs@22"], 2],
    [["--undo"], 2],
  ] as const) {
    const result = await autopilot(root, ...args);
    assert.equal(result.code, code, result.stderr);
  }
  assert.equal(await git(root, "branch", "--list", "offing/autopilot/*"), "");
  await rm(join(root, "package.json"));
  const clean = await autopilot(root, "--dry-run");
  assert.equal(clean.code, 0, clean.stderr);
  assert.match(clean.stdout, /Plan: no waves/);
  assert.match(clean.stdout, /None detected/);
  assert.match(clean.stdout, /No findings selected/);
});

test("prepare requires Git and an initial commit", async (t) => {
  const root = await repository(t, false);
  const missingGit = await autopilot(root, "--prepare");
  assert.equal(missingGit.code, 2, missingGit.stderr);
  assert.match(missingGit.stderr, /Git working tree/);
  await rm(join(root, "package.json"));
  await git(root, "init", "--quiet");
  const emptyGit = await autopilot(root, "--prepare");
  assert.equal(emptyGit.code, 2, emptyGit.stderr);
  assert.match(emptyGit.stderr, /committed Git HEAD/);
});
