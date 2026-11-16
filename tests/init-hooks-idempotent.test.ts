import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { runCli } from "./cli-runner.js";

const stableCases = [
  ["claude-code", ".claude/settings.json", '{ "env": { "NAME": "local" }, "hooks": { "PostToolUse": [] } }\r\n'],
  ["codex", ".codex/hooks.json", '{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[]}]}}'],
  ["cursor", ".cursor/hooks.json", '{\n "version": 1, "hooks": {}, "label": "local"\n}\n'],
] as const;

for (const [host, file, original] of stableCases) {
  test(`${host} install is byte-idempotent and remove restores the original config`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "offing-hook-round-trip-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, original);
    const install = ["init", "--hooks-for", host, root];
    const dry = await runCli([...install, "--dry-run"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.doesNotMatch(dry.stdout, /"NAME"|"label"|"matcher":"Edit"/);
    const first = await runCli(install);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, new RegExp(`^${host}: Updated .*; .*now runs Offing`));

    const installed = await readFile(path, "utf8");
    assert.notEqual(installed, original);
    assert.equal((await runCli(install)).code, 0);
    assert.equal(await readFile(path, "utf8"), installed);

    const remove = ["init", "--hooks", "--remove", "--hooks-for", host, root];
    const preview = await runCli([...remove, "--dry-run"]);
    assert.equal(preview.code, 0, preview.stderr);
    assert.equal(preview.stdout, `${host}: Would remove the Offing post-edit hook from ${file}.\n`);
    assert.equal(await readFile(path, "utf8"), installed);
    const removed = await runCli(remove);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(removed.stdout, `${host}: Removed the Offing post-edit hook from ${file}.\n`);
    assert.equal(await readFile(path, "utf8"), original);
    assert.equal((await runCli(remove)).stdout, "No managed Offing agent hooks found.\n");
  });
}

test("list shows seven stability labels and only detects matching markers and executables", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-hook-detection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const project = join(root, "project");
  const bin = join(root, "bin");
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(project, ".cursor"), { recursive: true });
  await mkdir(bin);
  const executable = join(bin, process.platform === "win32" ? "gemini.CMD" : "gemini");
  await writeFile(executable, "");
  await chmod(executable, 0o755);
  const env = {
    HOME: home,
    USERPROFILE: home,
    PATH: bin,
    PATHEXT: ".CMD",
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
  };
  const result = await runCli(["init", "--hooks", "--list", project], { env });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      "claude-code (stable, detected)",
      "cline (beta, not detected)",
      "codex (stable, not detected)",
      "copilot (beta, not detected)",
      "cursor (stable, detected)",
      "devin (beta, not detected)",
      "gemini (beta, detected)",
      "",
    ].join("\n"),
  );

  const refused = await runCli(["init", "--hooks-for", "codex", project], { env });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /codex was not detected/);
  await assert.rejects(readFile(join(project, ".codex/hooks.json")), { code: "ENOENT" });

  const install = await runCli(["init", "--hooks-for", "claude-code", project], { env });
  assert.deepEqual(install, {
    code: 0,
    stderr: "",
    stdout:
      "claude-code: Created .claude/settings.json; Claude Code now runs Offing after Write, Edit, and MultiEdit.\n",
  });
  await assert.rejects(readFile(join(home, ".claude/settings.json")), { code: "ENOENT" });
});

test("bulk removal recognizes legacy entries and preserves user commands in the same event", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-hook-remove-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, ".claude/settings.json");
  await mkdir(dirname(path));
  const custom = { matcher: "Write", hooks: [{ type: "command", command: "echo local" }] };
  const legacy = {
    matcher: "Write|Edit|MultiEdit",
    hooks: [{ type: "command", command: "npx --no-install offing hook claude-code", timeout: 60 }],
  };
  const untouched = { ...legacy, hooks: [...legacy.hooks, custom.hooks[0]] };
  await writeFile(path, JSON.stringify({ hooks: { PostToolUse: [legacy, custom, untouched] } }));
  const result = await runCli(["init", "--hooks", "--remove", root]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { hooks: { PostToolUse: [custom, untouched] } });
  assert.equal((await runCli(["init", "--hooks", "--remove", root])).stdout, "No managed Offing agent hooks found.\n");
});
