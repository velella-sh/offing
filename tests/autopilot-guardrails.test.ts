import { isIsoDate } from "@velella/ebb/registry";
import assert from "node:assert/strict";
import { ChildProcess, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";

import { createContainerReplayDriver, createReplayDriver } from "../src/agent-drivers/replay.js";
import { createBudget } from "../src/autopilot/limits/budget.js";
import { parseAutopilotConfig } from "../src/autopilot/limits/config.js";
import { createPathScope } from "../src/autopilot/limits/scope.js";
import { childEnvironments } from "../src/autopilot/limits/secrets.js";
import { inspectConfig } from "../src/config-validate.js";
import { ConfigError, validateConfig } from "../src/config.js";
import { buildFindingPacket } from "../src/migrate/prompt.js";
import { renderMigrationPrompt } from "../src/migration-prompt.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { profiles } from "../src/test-runners/profiles.js";
import { runCli } from "./cli-runner.js";

const command = promisify(execFile);
const idle = { turns: 1, tokens: 0, costCents: 0 };
const shaped = "ghp_" + "x".repeat(36);
const marked = "value-from-parent-env";
const privateKey = ["-----BEGIN OPENSSH PRIVATE KEY-----", "test", "-----END OPENSSH PRIVATE KEY-----"].join("\n");

async function scratch(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "offing-guardrails-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("autopilot config is optional and has the same nested validation and defaults as its schema", async (t) => {
  const schema = JSON.parse(await readFile("schemas/config.v1.schema.json", "utf8"));
  const validate = new Ajv2020({
    allowUnionTypes: true,
    ownProperties: true,
    useDefaults: true,
  })
    .addFormat("date", isIsoDate)
    .compile(schema);
  assert.deepEqual(validateConfig({}), {});
  const overrides = {
    driver: "replay",
    budget: {
      run: { wallTimeMs: 10, turns: 8, costCents: 0 },
      turn: { tokens: 900, costCents: 0 },
    },
    allowedPaths: ["project with spaces/tests.good.js"],
    deniedPaths: ["private.txt"],
    tests: [["node", "--test", "test.js"]],
    testRuntime: "container",
    secretEnv: ["MY_SECRET", "A_KEY_2"],
  };
  const invalid = [
    null,
    false,
    [],
    { enabled: true },
    { driver: "bogus-driver" },
    { driver: null },
    { testRuntime: "host" },
    { testRuntime: null },
    { budget: [] },
    { budget: { total: {} } },
    { budget: { run: false } },
    { budget: { turn: { sessions: 1 } } },
    { budget: { run: { wallTimeMs: 0 } } },
    { budget: { run: { wallTimeMs: 2147483648 } } },
    { budget: { turn: { turns: 1.5 } } },
    { budget: { run: { costCents: -1 } } },
    { budget: { turn: { tokens: "1" } } },
    { allowedPaths: ["../unsafe"] },
    { allowedPaths: ["a/./b"] },
    { allowedPaths: ["/absolute"] },
    { allowedPaths: ["c:/absolute"] },
    { allowedPaths: ["name\\other"] },
    { allowedPaths: ["name\nother"] },
    { allowedPaths: ["a//b"] },
    { deniedPaths: null },
    { deniedPaths: "private.txt" },
    { deniedPaths: [" "] },
    { tests: null },
    { tests: ["npm test"] },
    { tests: [[]] },
    { tests: [["\t"]] },
    { tests: [["npm", "a\0b"]] },
    { secretEnv: ["#KEY"] },
    { secretEnv: ["CLOUD_TOKEN\n"] },
    { secretEnv: [true] },
  ];
  for (const autopilot of invalid) {
    assert.equal(validate({ autopilot: structuredClone(autopilot) }), false, JSON.stringify(autopilot));
    assert.throws(() => validateConfig({ autopilot }), ConfigError, JSON.stringify(autopilot));
  }
  for (const value of [{}, { budget: {} }, { budget: { run: {}, turn: {} } }, overrides]) {
    const mutable = { autopilot: structuredClone(value) };
    assert.equal(validate(mutable), true, JSON.stringify(validate.errors));
    assert.deepEqual(validateConfig({ autopilot: value }), mutable);
  }
  const configFile = join(await scratch(t), ".offing.json");
  await writeFile(configFile, JSON.stringify({ autopilot: { budget: { turn: { tokens: -2 } } } }));
  const diagnostics = await inspectConfig(configFile);
  assert.equal(diagnostics.valid, false);
  assert.equal(diagnostics.diagnostics[0]?.pointer, "/autopilot/budget/turn/tokens");
});

function admit(budget: ReturnType<typeof createBudget>) {
  const permit = budget.begin();
  assert.ok("limits" in permit, JSON.stringify(permit));
  return permit;
}

test("budget controller offers the tighter ceilings and reports whether time, turns, tokens, or cost stopped work", () => {
  let time = 0;
  function start(run = {}, turn = {}) {
    time = 0;
    return createBudget(parseAutopilotConfig({ budget: { run, turn } }).budget, () => time);
  }
  const budget = start(
    { wallTimeMs: 700, turns: 2, tokens: 30, costCents: 60 },
    { wallTimeMs: 600, turns: 1, tokens: 20, costCents: 50 },
  );
  const first = admit(budget);
  assert.deepEqual(first.limits, {
    wallTimeMs: 600,
    turns: 1,
    tokens: 20,
    costCents: 50,
  });
  assert.deepEqual(budget.begin(), { stop: "turn-active" });
  time = 450;
  assert.equal(first.finish({ turns: 1, tokens: 17, costCents: 49 }), null);
  assert.equal(first.finish(idle), "invalid-usage");
  const next = admit(budget);
  assert.deepEqual(next.limits, {
    wallTimeMs: 250,
    turns: 1,
    tokens: 13,
    costCents: 11,
  });
  assert.equal(next.finish({ turns: 1, tokens: 13, costCents: 11 }), null);
  assert.deepEqual(budget.begin(), { stop: "run.turns" });

  const late = start({ wallTimeMs: 10 });
  time = 10;
  assert.deepEqual(late.begin(), { stop: "run.wallTimeMs" });
  for (const [run, turn, elapsed, expected] of [
    [{ wallTimeMs: 10 }, {}, 11, "run.wallTimeMs"],
    [{}, { wallTimeMs: 10 }, 11, "turn.wallTimeMs"],
  ] as const) {
    const working = start(run, turn);
    const permit = admit(working);
    time = elapsed;
    assert.equal(permit.finish(idle), expected);
    assert.deepEqual(working.begin(), { stop: expected });
  }
  for (const key of ["turns", "tokens", "costCents"] as const) {
    assert.equal(admit(start({ [key]: 1 })).finish({ ...idle, [key]: 2 }), "run." + key);
    assert.equal(admit(start({}, { [key]: 1 })).finish({ ...idle, [key]: 2 }), "turn." + key);
  }
  const tokenLimit = start({ tokens: 2 });
  assert.equal(admit(tokenLimit).finish({ ...idle, tokens: 2 }), null);
  assert.deepEqual(tokenLimit.begin(), { stop: "run.tokens" });
  const noPaidUse = admit(start({ costCents: 0 }));
  assert.equal(noPaidUse.limits.costCents, 0);
  assert.equal(noPaidUse.finish(idle), null);
  assert.equal(admit(start()).finish({ ...idle, turns: 0 }), "invalid-usage");
  assert.equal(admit(start()).finish({ ...idle, tokens: Number.NaN }), "invalid-usage");
});

test("scope is the exact packet and test file set and built-in denials override an allowlist", () => {
  const denied = [
    ".git/config",
    ".git~1/config",
    ".Github/Workflows/ci.yaml",
    ".github/workflows",
    "nested/.ENV.ci",
    "nested/.env/subpath",
    "path/id_ed25519",
    "certificate.pem",
    "nested/Package-Lock.JSON",
    "packages/go.sum",
    "demo/../inside",
    "src/file.js.",
    "/tmp/example",
    "unsafe\\path",
    "dir/.. /bad",
    "file\nname",
  ];
  const permits = createPathScope(
    parseAutopilotConfig({ deniedPaths: ["src/EXCLUDED.js"] }),
    [{ affectedFiles: ["src/file.js", "src/excluded.js", ...denied] }],
    ["tests/file.test.js"],
  );
  assert.ok(permits("src/file.js"));
  assert.ok(permits("tests/file.test.js"));
  for (const path of [...denied, "src/excluded.js", "src/other.js", "tests/other.test.js"]) {
    assert.equal(permits(path), false, path);
  }
  assert.ok(
    !createPathScope({ allowedPaths: [], deniedPaths: [] }, [{ affectedFiles: ["src/file.js"] }], [])("src/file.js"),
  );
});

test("real child processes receive an explicit allowlist and only the selected agent key", async () => {
  const source = {
    PATH: "/test/bin",
    TZ: "UTC",
    LANG: "C",
    LC_ALL: "private-locale",
    GITHUB_TOKEN: "other-provider",
    ANTHROPIC_API_KEY: "agent-only",
    OPENAI_API_KEY: "different-key",
    PRIVATE_ENV: marked,
    EMPTY_SECRET: "",
    UNSPECIFIED: undefined,
  };
  const env = childEnvironments(source, "claude", ["private_env", "LC_ALL", "EMPTY_SECRET"]);
  assert.deepEqual(env.tests, { PATH: "/test/bin", TZ: "UTC", LANG: "C" });
  assert.deepEqual(env.agent, {
    ...env.tests,
    ANTHROPIC_API_KEY: "agent-only",
  });
  assert.deepEqual(childEnvironments(source, "replay", []).agent, {
    PATH: "/test/bin",
    TZ: "UTC",
    LANG: "C",
    LC_ALL: "private-locale",
  });
  const children: readonly NodeJS.ProcessEnv[] = [env.agent, env.tests];
  for (const child of children) {
    const { stdout } = await command(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('__')))))",
      ],
      { env: child },
    );
    // Windows may supply system variables itself. Check only the variables Offing selected or withheld.
    const observed = JSON.parse(stdout);
    for (const key of Object.keys(source)) assert.equal(observed[key], child[key], key);
  }
  const report = [marked, "agent-only", "different-key", shaped, privateKey, "normal"].join(" ");
  assert.ok(env.containsSecret(report));
  assert.equal(env.redact(report), "[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] normal");
  assert.equal(env.containsSecret("ordinary output"), false);
  assert.equal(env.redact("ordinary output"), "ordinary output");
  const overlap = childEnvironments({ SECRET_A: "abc", SECRET_B: "bcdef" }, "codex", ["SECRET_A", "SECRET_B"]);
  assert.equal(overlap.redact("prefix abcdef suffix"), "prefix [REDACTED] suffix");
});

test("guarded replay refuses unauthorized and secret edits before touching the worktree", async (t) => {
  const worktreePath = await scratch(t);
  const recording = join(await scratch(t), "turns.json");
  const source = join(worktreePath, "example.txt");
  await writeFile(source, "before");
  const cases = [
    [{ "new.txt": "unexpected" }, /outside its scope/],
    [{ ".env.ci": "private" }, /outside its scope/],
    [{ "example.txt": marked }, /secret in a replay turn/],
    [{ "example.txt": shaped }, /secret in a replay turn/],
  ] as const;
  for (const [edit, diagnostic] of cases) {
    await writeFile(
      recording,
      JSON.stringify({
        schemaVersion: "offing.agent-replay.v1",
        turns: [{ "example.txt": "after" }, edit],
      }),
    );
    const config = parseAutopilotConfig({ secretEnv: ["PRIVATE_ENV"] });
    const driver = createReplayDriver(recording, {
      config,
      packets: [{ affectedFiles: ["example.txt", ".env.ci"] }],
      testFiles: [],
      environment: { PRIVATE_ENV: marked },
    });
    const output = await driver.run({
      worktreePath,
      prompt: "",
      timeoutMs: 1_000,
    });
    assert.equal(output.result.status, "blocked");
    assert.match(output.stderr, diagnostic);
    assert.ok(!JSON.stringify(output).includes(marked));
    assert.ok(!JSON.stringify(output).includes(shaped));
    assert.equal(await readFile(source, "utf8"), "before");
    await assert.rejects(readFile(join(worktreePath, ".env.ci")), {
      code: "ENOENT",
    });
  }
});

test("guarded replay retains the accepted turn and records the budget that refused the next", async (t) => {
  const worktreePath = await scratch(t);
  const recording = join(await scratch(t), "turns.json");
  const source = join(worktreePath, "example.txt");
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [{ "example.txt": "first accepted turn" }, { "example.txt": "forbidden second turn" }],
    }),
  );
  const config = parseAutopilotConfig({
    budget: { run: { turns: 1, costCents: 0 } },
  });
  const options = {
    config,
    packets: [],
    testFiles: ["example.txt"],
    environment: {},
    now: () => 0,
  };
  const output = await createReplayDriver(recording, options).run({
    worktreePath,
    prompt: "",
    timeoutMs: 1_000,
  });
  assert.equal(output.result.status, "blocked");
  assert.deepEqual(output.result.filesTouched, ["example.txt"]);
  assert.equal(output.result.turns, 1);
  assert.match(output.stderr, /budget stopped the run at run.turns/);
  assert.equal(await readFile(source, "utf8"), "first accepted turn");
});

test("acc-guardrails rolls back every write in the turn that overshoots its wall-time limit", async (t) => {
  const worktreePath = await scratch(t);
  const recording = join(await scratch(t), "turns.json");
  const source = join(worktreePath, "example.txt");
  await writeFile(source, "before");
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [{ "example.txt": "after", "new.txt": "new" }],
    }),
  );
  let clockCalls = 0;
  const output = await createReplayDriver(recording, {
    config: parseAutopilotConfig({ budget: { run: { wallTimeMs: 100 }, turn: { wallTimeMs: 10 } } }),
    packets: [],
    testFiles: ["example.txt", "new.txt"],
    now: () => (++clockCalls < 14 ? 0 : 11),
  }).run({ worktreePath, prompt: "", timeoutMs: 100 });
  assert.equal(output.result.status, "blocked");
  assert.match(output.stderr, /turn.wallTimeMs/);
  assert.deepEqual(output.result.filesTouched, []);
  assert.equal(await readFile(source, "utf8"), "before");
  await assert.rejects(readFile(join(worktreePath, "new.txt")), { code: "ENOENT" });
});

test("acc-guardrails strips marked multiline values and known patterns from rendered feedback packets", async (t) => {
  const root = await scratch(t);
  await writeFile(join(root, "package.json"), '{"dependencies":{"request":"2.88.2"}}');
  const scan = await scanWithBuiltIns(root, { noCache: true });
  const finding = scan.findings[0];
  assert.ok(finding);
  const packet = await buildFindingPacket(scan, finding.id, root);
  const multiline = `${marked}\nwith "quotes"`;
  packet.finding.title = `Fix ${multiline}`;
  packet.finding.summary = `Fix ${shaped}`;
  const { redact } = childEnvironments({ REPLAY_SECRET: multiline }, "replay", ["REPLAY_SECRET"]);
  const prompt = renderMigrationPrompt(packet, root, redact);
  assert.doesNotMatch(prompt, new RegExp(marked));
  assert.ok(!prompt.includes(shaped));
  assert.match(prompt, /\[REDACTED\]/u);
  const json = /```json\n([\s\S]+)\n```/u.exec(prompt)?.[1];
  assert.ok(json);
  assert.equal(JSON.parse(json).finding.summary, "Fix [REDACTED]");
});

test("container replay accepts only pinned, matching receipts and never falls back to a host edit", async (t) => {
  const root = await scratch(t);
  const recording = join(root, "recording.json");
  const target = join(root, "project.txt");
  const before = "before\n";
  const after = "after\n";
  const digest = createHash("sha256").update(after).digest("hex");
  await writeFile(target, before);
  await writeFile(
    recording,
    JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns: [{ "project.txt": after }] }),
  );
  const config = parseAutopilotConfig({ allowedPaths: ["project.txt"] });
  const options = { config, packets: [], testFiles: [] };
  const input = { worktreePath: root, prompt: "", timeoutMs: 10_000 };
  const calls: string[][] = [];
  let receipt: object = {};
  const connect = async () => (args: string[]) => {
    calls.push(args);
    const cmd = args[0];
    const output = cmd === "image" ? "linux/amd64\n" : args.includes("--eval") ? JSON.stringify(receipt) : "";
    return Object.assign(Promise.resolve({ stdout: Buffer.from(output), stderr: Buffer.from(marked) }), {
      child: Object.assign(new ChildProcess(), { stdin: new PassThrough() }),
    });
  };
  const driver = createContainerReplayDriver(recording, options, connect);
  for (receipt of [
    { completed: 0, stopped: null, files: [] },
    { completed: 1, stopped: "unexpected", files: [["project.txt", digest]] },
    { completed: 1, stopped: null, files: [["project.txt", "0".repeat(64)]] },
  ]) {
    const failed = await driver.run(input);
    assert.ok("stopReason" in failed);
    assert.equal(failed.stopReason, "container-runtime-unavailable");
    assert.ok(!failed.stderr.includes(marked));
    assert.equal(await readFile(target, "utf8"), before);
  }
  const unavailable = createContainerReplayDriver(recording, options, () => Promise.reject(new Error(marked)));
  const refused = await unavailable.run(input);
  assert.ok("stopReason" in refused);
  assert.equal(refused.stopReason, "container-runtime-unavailable");
  assert.ok(!refused.stderr.includes(marked));
  assert.equal(await readFile(target, "utf8"), before);
  receipt = { completed: 1, stopped: "run.tokens", files: [["project.txt", digest]] };
  const stopped = await driver.run(input);
  assert.ok("stopReason" in stopped);
  assert.equal(stopped.stopReason, "run.tokens");
  assert.equal(await readFile(target, "utf8"), after);
  receipt = { completed: 1, stopped: null, files: [["project.txt", digest]] };
  assert.equal((await driver.run(input)).exitCode, 0);
  assert.equal(await readFile(target, "utf8"), after);
  const launch = calls.find((args) => args[0] === "run");
  assert.ok(launch);
  assert.ok(launch.includes(profiles.npm.image));
  assert.ok(launch.includes("--read-only") && launch.includes("65532:65532"));
  assert.equal(launch[launch.indexOf("--network") + 1], "none");
  assert.equal(calls.filter((args) => args[0] === "rm").length, 5);
});

test("incremental replay verifies each admitted turn in Docker before editing and keeps the cumulative budget", async (t) => {
  const root = await scratch(t);
  const recording = join(root, "recording.json");
  const target = join(root, "project.txt");
  const before = "before\n";
  const first = "first\n";
  const digest = createHash("sha256").update(first).digest("hex");
  await writeFile(target, before);
  await writeFile(
    recording,
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: [{ "project.txt": first }, { "project.txt": "second\n" }],
      turnUsage: [
        { ...idle, tokens: 2 },
        { ...idle, tokens: 2 },
      ],
    }),
  );
  const config = parseAutopilotConfig({ allowedPaths: ["project.txt"], budget: { run: { tokens: 3 } } });
  const events: string[] = [];
  const connect = async () => (args: string[]) => {
    const worker = args.includes("--eval");
    const output = async () => {
      if (worker) {
        events.push("container");
        assert.equal(await readFile(target, "utf8"), before);
        return JSON.stringify({ completed: 1, stopped: null, files: [["project.txt", digest]] });
      }
      return args[0] === "image" ? "linux/amd64\n" : "";
    };
    return Object.assign(
      output().then((value) => ({ stdout: Buffer.from(value), stderr: Buffer.alloc(0) })),
      {
        child: Object.assign(new ChildProcess(), { stdin: new PassThrough() }),
      },
    );
  };
  const driver = createContainerReplayDriver(
    recording,
    {
      config,
      packets: [],
      testFiles: [],
      async beforeTurn(number) {
        events.push(`before-${number}`);
        return (path) => path === "project.txt";
      },
      async afterTurn(number, files) {
        events.push(`after-${number}`);
        assert.deepEqual(files, ["project.txt"]);
        assert.equal(await readFile(target, "utf8"), first);
        return false;
      },
    },
    connect,
  );
  const result = await driver.run({ worktreePath: root, prompt: "", timeoutMs: 10_000 });
  assert.ok("stopReason" in result);
  assert.equal(result.stopReason, "run.tokens");
  assert.equal(result.result.turns, 1);
  assert.deepEqual(events, ["before-1", "container", "after-1", "before-2"]);
  assert.equal(await readFile(target, "utf8"), first);
});

test("acc-guardrails exercises the prepared Autopilot replay workflow and dry run in a disposable Git repository", async (t) => {
  const root = await scratch(t);
  const recording = join(await scratch(t), "turns.json");
  const git = async (...args: string[]) => (await command("git", args, { cwd: root })).stdout.trim();
  const manifest = JSON.stringify({
    dependencies: { request: "2.88.2" },
    scripts: { test: "node --test tests/migration.test.js" },
  });
  const testSource = [
    'const assert = require("node:assert/strict");',
    'assert.equal(process.cwd(), "/work/tree");',
    'assert.equal(process.env.HOME, "/tmp");',
    "assert.equal(process.env.REPLAY_FIXTURE_SECRET, undefined);",
    "",
  ].join("\n");
  await git("init", "--quiet");
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "package.json"), manifest);
  await writeFile(join(root, "tests", "migration.test.js"), testSource);
  await writeFile(
    join(root, ".offing.json"),
    JSON.stringify({
      autopilot: {
        secretEnv: ["REPLAY_FIXTURE_SECRET"],
        budget: { run: { tokens: 9, costCents: 10 }, turn: { costCents: 4 } },
      },
    }),
  );
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
  const installedCli = process.env.OFFING_GUARDRAILS_CLI;
  const invoke = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    if (!installedCli) return runCli(args, { env });
    try {
      const result = await command(process.execPath, [installedCli, ...args], { env: { ...process.env, ...env } });
      return { ...result, code: 0 };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "number" &&
        "stdout" in error &&
        typeof error.stdout === "string" &&
        "stderr" in error &&
        typeof error.stderr === "string"
      )
        return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      throw error;
    }
  };
  const initialWorktrees = await git("worktree", "list", "--porcelain");
  const preview = await invoke(["autopilot", root, "--dry-run", "--agent", "replay"], { PATH: "" });
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /Plan: wave 0/u);
  assert.match(preview.stdout, /First prompt preview/u);
  assert.doesNotMatch(preview.stdout, /Run record:/u);
  assert.equal(await git("worktree", "list", "--porcelain"), initialWorktrees);
  assert.equal(await git("status", "--porcelain"), "");

  const start = async (turn: Record<string, string>, usage?: typeof idle) => {
    await writeFile(
      recording,
      JSON.stringify({
        schemaVersion: "offing.agent-replay.v1",
        turns: [turn],
        ...(usage ? { turnUsage: [usage] } : {}),
      }),
    );
    const result = await invoke(["autopilot", root, "--prepare", "--replay", recording], {
      REPLAY_FIXTURE_SECRET: marked,
    });
    const recordFile = /Run record: ([^\r\n]+)/u.exec(result.stdout)?.[1];
    assert.ok(recordFile, result.stderr);
    const raw = await readFile(recordFile, "utf8");
    assert.ok(!raw.includes(marked) && !raw.includes(shaped));
    const record = JSON.parse(raw);
    const checkout = join(dirname(recordFile), "checkout");
    t.after(async () => {
      if (await readFile(recordFile).catch(() => undefined))
        await invoke(["autopilot", root, "--undo", record.checkout.id]);
    });
    return { result, record, checkout, recordFile };
  };
  const undo = async (run: Awaited<ReturnType<typeof start>>) => {
    const result = await invoke(["autopilot", root, "--undo", run.record.checkout.id]);
    assert.equal(result.code, 0, result.stderr);
    await assert.rejects(readFile(run.recordFile), { code: "ENOENT" });
  };
  for (const [edit, reason, usage] of [
    [{ "outside.txt": "unapproved" }, "outside-path-scope"],
    [{ ".env.ci": "blocked path" }, "outside-path-scope"],
    [{ "package.json": marked }, "secret-turn-diff"],
    [{ "tests/migration.test.js": shaped }, "secret-turn-diff"],
    [{ "package.json": "{}" }, "run.tokens", { ...idle, tokens: 10 }],
    [{ "package.json": "{}" }, "turn.costCents", { ...idle, costCents: 5 }],
  ] as const) {
    const run = await start(edit, usage);
    assert.equal(run.result.code, 1);
    assert.equal(run.record.stopReason, reason);
    assert.deepEqual(run.record.transitions, ["scan", "plan", "agent-turn", "stopped"]);
    assert.equal(await readFile(join(run.checkout, "package.json"), "utf8"), manifest);
    await assert.rejects(readFile(join(run.checkout, ".env.ci")), { code: "ENOENT" });
    await undo(run);
  }
  if (!installedCli && process.env.OFFING_VERIFY_REPLAY_DOCKER !== "1") {
    assert.equal(await git("status", "--porcelain"), "");
    return;
  }
  const tested = await invoke(["autopilot", root, "--test-only"], { REPLAY_FIXTURE_SECRET: marked });
  assert.equal(tested.code, 0, tested.stderr);
  assert.match(tested.stdout, /Pinned Docker tests\npassed \["npm","run","test"\]/u);
  const accepted = await start({ "package.json": "{}", "tests/migration.test.js": "// after\n" });
  assert.equal(accepted.result.code, 0, accepted.result.stderr + "\n" + accepted.record.stopReason);
  assert.equal(accepted.record.stopReason, "replay-prepared");
  assert.equal(await readFile(join(accepted.checkout, "package.json"), "utf8"), "{}");
  assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
  try {
    const refused = await invoke(["autopilot", root, "--undo", accepted.record.checkout.id]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /worktree with local changes/u);
  } finally {
    await writeFile(join(accepted.checkout, "package.json"), manifest);
    await writeFile(join(accepted.checkout, "tests", "migration.test.js"), testSource);
    await undo(accepted);
  }
  assert.equal(await git("status", "--porcelain"), "");
});
