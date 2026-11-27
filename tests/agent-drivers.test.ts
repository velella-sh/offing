import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";

import { createCommandAgent } from "../src/agent-drivers/command.js";
import { vendorByName } from "../src/agent-drivers/index.js";
import { createReplayDriver } from "../src/agent-drivers/replay.js";
import { checkedResult } from "../src/agent-drivers/result.js";
import { readMetrics } from "../src/agent-drivers/usage.js";
import { git } from "../src/migrate/worktree.js";
import { runCli } from "./cli-runner.js";

const execute = promisify(execFile);
const standalone = resolve("docs/spec/agent-driver/conformance/check.mjs");
const reference = resolve("docs/spec/agent-driver/example/driver.mjs");

async function worktree(t: { after(callback: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "offing-agent-drivers-test-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const cwd = join(root, "checkout");
  await mkdir(cwd);
  await writeFile(join(cwd, "example.txt"), "before\n");
  const input = { worktreePath: cwd, allowedPaths: ["example.txt"], prompt: "test", timeoutMs: 5_000 };
  return { root, cwd, input };
}

test("the downloaded checker and installed CLI test the reference edit, scope and timeout", async (t) => {
  const { root } = await worktree(t);
  const localChecker = join(root, "check.mjs");
  const localReference = join(root, "driver.mjs");
  await writeFile(localChecker, await readFile(standalone));
  await writeFile(localReference, await readFile(reference));
  const external = await execute(process.execPath, [localChecker, process.execPath, localReference], { cwd: root });
  assert.match(external.stdout, /acc-agent-drivers: edit, out-of-scope write and timeout cases passed/);
  const tested = await runCli(["drivers", "test", `"${process.execPath}" "${localReference}"`], { cwd: root });
  assert.equal(tested.code, 0, tested.stderr);
  assert.match(tested.stdout, /acc-agent-drivers/);
  assert.match((await runCli(["drivers", "test", "replay"])).stdout, /acc-agent-drivers/);
  const missing = await runCli(["drivers", "test"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /drivers list or drivers test/);
  const generic = await runCli(["drivers", "test", "command"]);
  assert.equal(generic.code, 1);
  assert.match(generic.stderr, /trusted shell command/);
});

test("a command gets both prompt variables and preserves the legacy exit-only contract", async (t) => {
  const { root, input } = await worktree(t);
  const shim = join(root, "command.cjs");
  await writeFile(
    shim,
    `const fs = require("node:fs");
     const env = process.env;
     if (env.OFFING_PROMPT_FILE !== env.OFFING_MIGRATION_PROMPT_FILE) process.exit(2);
     if (env.OFFING_WORKTREE !== process.cwd() && fs.realpathSync(env.OFFING_WORKTREE) !== fs.realpathSync(process.cwd())) process.exit(3);
     if (env.OFFING_TIMEOUT_SECONDS !== "5" || env.OFFING_ALLOWED_PATHS !== '["example.txt"]') process.exit(4);
     console.log(fs.readFileSync(env.OFFING_PROMPT_FILE, "utf8"));\n`,
  );
  const command = `"${process.execPath}" "${shim}"`;
  const driver = createCommandAgent({ command });
  assert.equal(await driver.detect(), true);
  assert.equal(await driver.version(), null);
  const run = await driver.run(input);
  assert.equal(run.exitCode, 0, run.stderr);
  assert.equal(run.stdout.trim(), "test");
  assert.equal(run.result.status, "completed");
  await assert.rejects(createCommandAgent({ command, requireResult: true }).run(input), /result.json/);
});

test("replay applies all recorded turns and rejects unapproved paths before any write", async (t) => {
  const { root, cwd, input } = await worktree(t);
  const driver = createReplayDriver(resolve("tests/fixtures/agent-drivers/turns.json"));
  const { result } = await driver.run(input);
  assert.deepEqual(result.filesTouched, ["example.txt"]);
  assert.equal(result.turns, 2);
  assert.equal(await readFile(join(cwd, "example.txt"), "utf8"), "after\n");
  const ajv = new Ajv2020();
  const schema = JSON.parse(await readFile("schemas/agent-run.v1.schema.json", "utf8"));
  assert.equal(ajv.compile(schema)(result), true);
  assert.deepEqual(checkedResult(result), result);
  assert.throws(() => checkedResult({ ...result, filesTouched: ["../outside.txt"] }), /Invalid offing.agent-run/);
  assert.throws(() => checkedResult({ ...result, usage: { inputTokens: Infinity } }), /Invalid offing.agent-run/);
  const recording = join(root, "bad.json");
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [{ "example.txt": "do not change", "other.txt": "must be blocked" }],
    }),
  );
  const blocked = await createReplayDriver(recording).run(input);
  assert.equal(blocked.result.status, "blocked");
  assert.equal(await readFile(join(cwd, "example.txt"), "utf8"), "after\n");
  await writeFile(recording, JSON.stringify({ schemaVersion: "invalid", turns: [] }));
  assert.match((await createReplayDriver(recording).run(input)).stderr, /Expected offing.agent-replay/);
});

test("replay refuses a symlink destination without touching the target", {
  skip: process.platform === "win32",
}, async (t) => {
  const { root, cwd, input } = await worktree(t);
  const target = join(root, "outside.txt");
  await writeFile(target, "safe");
  await rm(join(cwd, "example.txt"));
  await symlink(target, join(cwd, "example.txt"));
  const result = await createReplayDriver(resolve("tests/fixtures/agent-drivers/turns.json")).run(input);
  assert.equal(result.result.status, "blocked");
  assert.equal(await readFile(target, "utf8"), "safe");
});

const inputs = [
  {
    name: "claude",
    version: "2.1.330",
    arg: "--restricted",
    machine: '{"num_turns":3,"total_cost_usd":0.02,"usage":{"input_tokens":2,"output_tokens":4}}',
    input: 2,
    output: 4,
    cost: 0.02,
    turns: 3,
  },
  {
    name: "codex",
    version: "0.171.0-alpha.13.2",
    arg: "workspace-write",
    machine: '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":8}}\n',
    input: 5,
    output: 8,
    cost: null,
    turns: 1,
  },
  {
    name: "gemini",
    version: "0.71.1",
    arg: "auto_edit",
    machine:
      '{"stats":{"models":{"g":{"tokens":{"prompt":2,"candidates":7}},"h":{"tokens":{"prompt":3,"candidates":4}}}}}',
    input: 5,
    output: 11,
    cost: null,
    turns: null,
  },
  {
    name: "aider",
    version: "0.86.2",
    arg: "--no-auto-commits",
    machine: "human output",
    input: null,
    output: null,
    cost: null,
    turns: null,
  },
];

test("vendor adapters pin versions, scope and arguments without invoking a model", {
  skip: process.platform === "win32",
}, async (t) => {
  const { root, cwd, input } = await worktree(t);
  const shimDir = join(root, "bin");
  await mkdir(shimDir);
  await git(["init", "-q"], cwd);
  await git(["add", "--", "example.txt"], cwd);
  const oldPath = process.env.PATH;
  process.env.PATH = shimDir + delimiter + oldPath;
  try {
    for (const item of inputs) {
      const shim = join(shimDir, item.name);
      await writeFile(
        shim,
        `#!/usr/bin/env node\nconst fs = require("node:fs");
         if (process.argv.includes("--version")) console.log(${JSON.stringify(item.version)});
         else {
           if (!process.argv.includes(${JSON.stringify(item.arg)})) process.exit(2);
           fs.writeFileSync("example.txt", "after\\n");
           process.stdout.write(${JSON.stringify(item.machine)});
         }\n`,
        { mode: 0o755 },
      );
      const driver = vendorByName(item.name);
      assert.ok(driver);
      assert.equal(await driver.detect(), true);
      assert.equal(await driver.version(), item.version);
      const output = await driver.run(input);
      assert.equal(output.exitCode, 0, output.stderr);
      assert.deepEqual(output.result.usage, { inputTokens: item.input, outputTokens: item.output, costUsd: item.cost });
      assert.equal(output.result.turns, item.turns);
      assert.deepEqual(output.result.filesTouched, ["example.txt"]);
    }
    const listed = await runCli(["drivers", "list"]);
    assert.match(listed.stdout, /codex\t0\.171\.0-alpha\.13\.2/);
    await writeFile(join(shimDir, "codex"), "#!/usr/bin/env node\nconsole.log('7.0.0');\n");
    await assert.rejects(vendorByName("codex")?.run(input) ?? Promise.resolve(), /supported versions/);
    await mkdir(join(cwd, ".gemini"));
    const gemini = vendorByName("gemini");
    assert.ok(gemini);
    await assert.rejects(gemini.run(input), /refused repository configuration at .gemini/);
    await rm(join(cwd, ".gemini"), { recursive: true });
    const denied = await vendorByName("aider")?.run({ ...input, allowedPaths: [] });
    assert.equal(denied?.result.status, "blocked");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("malformed or missing usage remains unknown", () => {
  for (const name of ["claude", "codex", "gemini", "aider"]) {
    const summary = readMetrics(name, "bad json");
    assert.deepEqual(summary.usage, { inputTokens: null, outputTokens: null, costUsd: null });
  }
  assert.equal(readMetrics("gemini", '{"stats":{"models":{"missing":{"tokens":{}}}}}').usage.inputTokens, null);
});

test("migration rejects contradictory or unknown driver options before touching a checkout", async () => {
  const cases = [
    [["--driver", "replay", "--replay", ""], /Use --driver replay/],
    [["--driver", "codex", "--agent", "cmd"], /Use --agent or --driver/],
    [["--driver", "missing"], /Unknown driver/],
    [[], /Use --agent to name the command/],
  ] as const;
  for (const [args, message] of cases) {
    const outcome = await runCli(["migrate", "fixture-id", ...args]);
    assert.equal(outcome.code, 2);
    assert.match(outcome.stderr, message);
  }
});
