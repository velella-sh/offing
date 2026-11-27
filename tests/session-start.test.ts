import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { runCli } from "./cli-runner.js";

const sessions = [
  ["claude-code", ".claude/settings.json", "SessionStart", "additionalContext", true],
  ["codex", ".codex/hooks.json", "SessionStart", "additionalContext", true],
  ["cursor", ".cursor/hooks.json", "sessionStart", "additional_context", false],
  ["copilot", ".github/hooks/offing.json", "sessionStart", "additionalContext", false],
  ["gemini", ".gemini/settings.json", "SessionStart", "additionalContext", true],
  ["devin", ".devin/hooks.v1.json", "SessionStart", "additionalContext", true],
  ["cline", ".clinerules/hooks/TaskStart", "TaskStart", "contextModification", false],
] as const;

test("session starts supply context through each documented host envelope and fail open once", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-session-start-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".nvmrc"), "18\n");
  const env = {
    ...process.env,
    OFFING_CACHE_DIR: join(root, "cache"),
    OFFING_DATA_VERSION: "bundled",
    OFFING_NO_CACHE: "0",
  };
  const cli = resolve("dist/src/cli.js");
  const run = (args: string[], environment = env) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: root, env: environment, input: "{}\n", encoding: "utf8" });
  const missing = run(["hook", "session-start", "claude-code"]);
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /^Offing stack context unavailable:[^\n]+\n$/);
  const scan = run(["scan", ".", "--json"]);
  assert.equal(scan.status, 0, scan.stderr);
  for (const [host, , event, field, nested] of sessions) {
    const result = run(["hook", "session-start", host]);
    assert.equal(result.status, 0, `${host}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    const json = JSON.parse(result.stdout);
    const envelope = nested ? json.hookSpecificOutput : json;
    if (nested && host !== "gemini") assert.equal(envelope.hookEventName, event);
    if (host === "cline") assert.equal(envelope.cancel, false);
    assert.match(envelope[field], /"schemaVersion": "offing\.stack-context\.v1"/);
    assert.match(envelope[field], /"inUse": "18"/);
  }
  const failed = run(["hook", "session-start", "claude-code"], { ...env, OFFING_DATA_VERSION: "invalid-dataset" });
  assert.equal(failed.status, 0);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /^Offing stack context unavailable: the local scan could not be read\.\n$/);
  assert.match(run(["hook", "session-start", "unknown"]).stderr, /^Offing stack context skipped:[^\n]+\n$/);
});

test("init previews and installs one session-start hook beside each host's write hooks", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "offing-session-install-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  for (const [host, file, event] of sessions) {
    const root = join(work, host);
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    const args = ["init", "--hooks-for", host, root];
    const preview = await runCli([...args, "--dry-run"]);
    assert.equal(preview.code, 0, `${host}: ${preview.stderr}`);
    await assert.rejects(readFile(path), { code: "ENOENT" });
    const installed = await runCli(args);
    assert.equal(installed.code, 0, `${host}: ${installed.stderr}`);
    const text = await readFile(path, "utf8");
    assert.equal(text.split(`offing hook session-start ${host}`).length, 2);
    if (host !== "cline") {
      const document = JSON.parse(text);
      assert.equal((document.hooks ?? document)[event].length, 1);
    }
    assert.equal((await runCli(args)).code, 0);
    assert.equal(await readFile(path, "utf8"), text);
    const removed = await runCli([...args, "--hooks", "--remove"]);
    assert.equal(removed.code, 0, `${host}: ${removed.stderr}`);
    assert.doesNotMatch(await readFile(path, "utf8"), /hook session-start/);
  }
});
