import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

import { runActionAutopilot } from "../src/action-autopilot.js";
import { runApprovedTest } from "../src/test-runners/run.js";

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec("git", args, { cwd })).stdout.trim();
const installed = process.env.OFFING_AUTOPILOT_ACTION_BUNDLE;
const posixExecutable = { skip: process.platform === "win32" };
const selectedKey = "fixture-selected-placeholder";
const otherKey = "fixture-other-placeholder";
const manifest = { name: "action-fixture", scripts: { test: "node tests/check.cjs" } };
const original = JSON.stringify({ ...manifest, dependencies: { request: "2.88.2" } });
const repaired = JSON.stringify(manifest) + "\n";
const xml = '<testsuite tests="1" failures="0"><testcase name="fixture" file="tests/check.cjs"/></testsuite>';

function fakeClaude(proposal: Array<{ path: string; content: string }>, version: string) {
  return `#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const args = process.argv.slice(2);
for (const key of ["OPENAI_API_KEY", "OTHER_SECRET", "OFFING_ACTION_AUTOPILOT_KEY", "GITHUB_TOKEN", "INPUT_GITHUB-TOKEN"])
  assert.equal(process.env[key], undefined);
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(process.env.HOME));
if (args[0] === "--version") {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  console.log(${JSON.stringify(version)} + " (Claude Code)");
} else {
  assert.equal(process.env.ANTHROPIC_API_KEY, ${JSON.stringify(selectedKey)});
  assert.ok(args.includes("--restricted"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args[args.indexOf("--max-turns") + 1], "1");
  assert.equal(args[args.indexOf("--max-budget-usd") + 1], "0.5");
  const prompt = fs.readFileSync(0, "utf8");
  assert.ok(prompt.includes("request"));
  assert.ok(prompt.includes("package.json"));
  assert.ok(!prompt.includes(process.env.ANTHROPIC_API_KEY));
  assert.ok(!prompt.includes(${JSON.stringify(otherKey)}));
  console.error(process.env.ANTHROPIC_API_KEY);
  console.log(JSON.stringify({subtype: "success", is_error: false, total_cost_usd: 0.01, num_turns: 1,
    usage: {input_tokens: 30, output_tokens: 20}, structured_output: {edits: ${JSON.stringify(proposal)}}}));
}
`;
}

async function cleanup(root: string) {
  const listing = await git(root, "worktree", "list", "--porcelain").catch(() => "");
  for (const line of listing.split("\n")) {
    const path = line.startsWith("worktree ") ? line.slice("worktree ".length) : "";
    if (path && path !== root && dirname(path).includes("offing-autopilot-")) {
      await git(root, "worktree", "remove", "--force", path).catch(() => undefined);
      await rm(dirname(path), { recursive: true, force: true });
    }
  }
}

async function fixture(t: TestContext, proposal = [{ path: "package.json", content: repaired }], version = "2.1.330") {
  const folder = await mkdtemp(join(tmpdir(), "offing-action-autopilot-test-"));
  const root = join(folder, "repository");
  t.after(async () => {
    await cleanup(await git(root, "rev-parse", "--show-toplevel").catch(() => root));
    await rm(folder, { recursive: true, force: true });
  });
  await mkdir(join(root, "tests"), { recursive: true });
  const bin = join(folder, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "claude"), fakeClaude(proposal, version), { mode: 0o700 });
  await writeFile(join(root, "package.json"), original + "\n");
  await writeFile(
    join(root, "tests/check.cjs"),
    `const assert = require("node:assert/strict");
for (const name of ["ANTHROPIC_API_KEY", "OFFING_ACTION_AUTOPILOT_KEY", "OTHER_SECRET", "GITHUB_TOKEN"])
  assert.equal(process.env[name], undefined);
require("node:fs").writeFileSync("junit.xml", ${JSON.stringify(xml)});`,
  );
  await writeFile(join(root, ".offing.json"), JSON.stringify({ autopilot: { tests: [["node", "tests/check.cjs"]] } }));
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "add", ".");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture");
  const event = join(folder, "event.json");
  await writeFile(event, JSON.stringify({ repository: { fork: false, default_branch: "main" } }));
  const env = {
    ...process.env,
    PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
    OFFING_ACTION_AUTOPILOT: "true",
    OFFING_ACTION_AUTOPILOT_SECRET_NAME: "MIGRATION_FIXTURE_KEY",
    INPUT_AGENT: "claude",
    OFFING_ACTION_AUTOPILOT_KEY: selectedKey,
    ANTHROPIC_API_KEY: "wrong-provider-value",
    OPENAI_API_KEY: otherKey,
    GITHUB_TOKEN: otherKey,
    "INPUT_GITHUB-TOKEN": otherKey,
    OTHER_SECRET: otherKey,
    GITHUB_WORKSPACE: root,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: await git(root, "rev-parse", "HEAD"),
    GITHUB_EVENT_PATH: event,
  };
  return { root, env };
}

async function fixtureTests(_tree: string, deadline: number) {
  return [
    await runApprovedTest(["node", "tests/check.cjs"], async () => ({ exitCode: 0, reports: [xml] }), 1000, deadline),
  ];
}

test(
  "acc-autopilot-action runs the scoped driver through the Action and keeps the selected key out of evidence",
  posixExecutable,
  async (t) => {
    const { root, env } = await fixture(t);
    if (installed) {
      const output = await exec(process.execPath, [resolve(installed)], { cwd: root, env, timeout: 180_000 }).catch(
        (error: unknown) => {
          if (error && typeof error === "object" && "stdout" in error)
            assert.fail(String(error.stdout) + ("stderr" in error ? String(error.stderr) : ""));
          throw error;
        },
      );
      assert.match(output.stdout, /Offing Autopilot verified/u);
      assert.doesNotMatch(output.stderr + output.stdout, /fixture-(selected|other)-placeholder/u);
    } else {
      assert.equal(await runActionAutopilot(env, fixtureTests), true);
      assert.equal(env.OFFING_ACTION_AUTOPILOT_KEY, undefined);
    }
    assert.equal(await readFile(join(root, "package.json"), "utf8"), original + "\n");
    assert.equal(await git(root, "status", "--porcelain"), "");
    const branch = await git(root, "branch", "--list", "--format=%(refname:short)", "offing/autopilot/*");
    assert.match(branch, /^offing\/autopilot\/[\w]+$/u);
    assert.equal(await git(root, "show", `${branch}:package.json`), repaired.trimEnd());
    const worktrees = await git(root, "worktree", "list", "--porcelain");
    const worktree = worktrees
      .split("\n")
      .find((line) => line.includes("/offing-autopilot-") && line.endsWith("/checkout"));
    assert.ok(worktree);
    const evidence = dirname(worktree.slice("worktree ".length));
    for (const file of await readdir(evidence)) {
      if (file.endsWith(".json")) {
        const text = await readFile(join(evidence, file), "utf8");
        assert.doesNotMatch(text, /fixture-(selected|other)-placeholder/u);
        if (file === "turn-1-agent.json") assert.equal(JSON.parse(text).driver.name, "claude");
      }
    }
    const final = JSON.parse(await readFile(join(evidence, "autopilot-run.v1.json"), "utf8"));
    assert.equal(final.state, "done");
    assert.equal(final.replay.turn, 1);
  },
);

test("requires the exact selected secret and refuses alternate events before touching Git", async (t) => {
  const { root, env } = await fixture(t);
  await assert.rejects(
    runActionAutopilot({ ...env, GITHUB_EVENT_NAME: "pull_request_target" }),
    /requires an explicit workflow_dispatch/u,
  );
  await assert.rejects(
    runActionAutopilot({ ...env, GITHUB_REF: "refs/heads/feature" }),
    /requires the default branch/u,
  );
  await assert.rejects(
    runActionAutopilot({ ...env, OFFING_ACTION_AUTOPILOT_SECRET_NAME: "not a secret name" }),
    /selected secret name/u,
  );
  const missing = { ...env, OFFING_ACTION_AUTOPILOT_KEY: "" };
  if (installed) {
    await assert.rejects(
      exec(process.execPath, [resolve(installed)], { cwd: root, env: missing }),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "stdout" in error);
        assert.match(String(error.stdout), /needs the selected secret MIGRATION_FIXTURE_KEY/u);
        return true;
      },
    );
  } else {
    await assert.rejects(runActionAutopilot(missing), /needs the selected secret MIGRATION_FIXTURE_KEY/u);
  }
  assert.equal(await git(root, "branch", "--list", "offing/autopilot/*"), "");
});

for (const invalid of [
  { path: "package.json", content: selectedKey },
  { path: "tests/check.cjs", content: "unapproved edit" },
]) {
  test(`rejects an invalid proposal to ${invalid.path} without a partial write`, posixExecutable, async (t) => {
    const { root, env } = await fixture(
      t,
      invalid.path === "package.json" ? [invalid] : [{ path: "package.json", content: repaired }, invalid],
    );
    await assert.rejects(runActionAutopilot(env, fixtureTests), /live-proposal-refused/u);
    const branch = await git(root, "branch", "--list", "--format=%(refname:short)", "offing/autopilot/*");
    assert.equal(await git(root, "show", `${branch}:package.json`), original);
    assert.equal(await git(root, "status", "--porcelain"), "");
  });
}

test("version preflight refuses the driver before opening a credential-bearing process", posixExecutable, async (t) => {
  const { env } = await fixture(t, [], "2.1.331");
  await assert.rejects(runActionAutopilot(env, fixtureTests), /Install the pinned Claude Code version/u);
});

test("regular Action runs drop an unused Autopilot key", async () => {
  const env = { OFFING_ACTION_AUTOPILOT_KEY: selectedKey };
  assert.equal(await runActionAutopilot(env), false);
  assert.equal(env.OFFING_ACTION_AUTOPILOT_KEY, undefined);
});

test("the Autopilot template, composite inputs, and v1 contract agree", async () => {
  const metadata = parse(await readFile("action.yml", "utf8"));
  const template = parse(await readFile("templates/workflows/offing-autopilot.yml", "utf8"));
  const spec = await readFile("docs/spec/action/v1.md", "utf8");
  const inputs = {
    autopilot: "false",
    agent: "claude",
    "agent-key-secret": "",
    "autopilot-wave": "0",
    "autopilot-recording": "",
    "autopilot-wall-time-ms": "",
    "autopilot-turns": "",
    "autopilot-tokens": "",
    "autopilot-cost-cents": "",
    "autopilot-open-red": "false",
  };
  const scan = metadata.runs.steps.find(({ id }: { id?: string }) => id === "scan");
  for (const [name, fallback] of Object.entries(inputs)) {
    assert.equal(metadata.inputs[name].default, fallback);
    assert.equal(scan.env[`INPUT_${name.toUpperCase()}`], "${{ inputs." + name + " }}");
    assert.ok(spec.includes(`| \`${name}\` | ${fallback ? `\`${fallback}\`` : "empty"} |`));
  }
  assert.equal(metadata.outputs["autopilot-pr-urls"].value, "${{ steps.scan.outputs.autopilot-pr-urls }}");
  assert.ok(spec.includes("| `autopilot-pr-urls` |"));
  assert.deepEqual(template.on, { workflow_dispatch: null });
  assert.deepEqual(template.permissions, { contents: "read" });
  assert.deepEqual(template.jobs.migrate.permissions, { contents: "write", "pull-requests": "write" });
  const consumer = template.jobs.migrate.steps.at(-1);
  assert.equal(consumer.with.autopilot, "true");
  assert.equal(consumer.env.OFFING_ACTION_AUTOPILOT_KEY, "${{ secrets." + consumer.with["agent-key-secret"] + " }}");
});
