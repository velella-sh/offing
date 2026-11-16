import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { TestContext } from "node:test";

import { runCli } from "../cli-runner.js";

export type StableHost = "claude-code" | "codex" | "cursor";

const configFiles: Record<StableHost, string> = {
  "claude-code": ".claude/settings.json",
  codex: ".codex/hooks.json",
  cursor: ".cursor/hooks.json",
};

interface InstalledEntry {
  readonly command?: string;
  readonly hooks?: readonly { readonly command: string }[];
}

function configuredCommand(text: string, host: StableHost, event: string): string {
  const document = JSON.parse(text) as { hooks: Record<string, readonly InstalledEntry[]> };
  const entry = document.hooks[event]?.[0];
  const command = entry?.command ?? entry?.hooks?.[0]?.command;
  assert.equal(command, `offing hook ${host}`);
  return command;
}

export async function installedHook(t: TestContext, host: StableHost) {
  const directory = await mkdtemp(join(tmpdir(), "offing-installed-hook-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "project");
  const hostDirectory = configFiles[host].split("/")[0] ?? "";
  await mkdir(join(root, hostDirectory), { recursive: true });
  const dockerfile = join(root, "Dockerfile");
  const template = await readFile(`tests/fixtures/agent-hooks/${host}/repo/image.template.fixture`, "utf8");
  await writeFile(dockerfile, template.replace("{{NODE_LINE}}", "16"));

  const install = await runCli(["init", "--hooks-for", host, root]);
  assert.equal(install.code, 0, install.stderr);
  const config = await readFile(join(root, configFiles[host]), "utf8");
  const command = configuredCommand(config, host, host === "cursor" ? "afterFileEdit" : "PostToolUse");
  const preEvent = host === "cursor" ? "preToolUse" : "PreToolUse";
  const preCommand = configuredCommand(config, host, preEvent);
  const bin = join(directory, "bin");
  await mkdir(bin);
  const cli = resolve("dist/src/cli.js");
  if (process.platform === "win32") {
    await writeFile(join(bin, "offing.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`);
  } else {
    await writeFile(join(bin, "offing"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
  }
  const input = (await readFile(`tests/fixtures/hook-payloads/${host}.json`, "utf8")).replaceAll("/Users/dev/app", () =>
    JSON.stringify(root).slice(1, -1),
  );
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    OFFING_CACHE_DIR: join(directory, "cache"),
    EBB_DATA_DIR: join(directory, "data"),
    OFFING_DATA_VERSION: "bundled",
    OFFING_NO_CACHE: "0",
  };
  return {
    root,
    dockerfile,
    beforeWrite: (tool: string, args: Record<string, unknown>) =>
      spawnSync(preCommand, {
        cwd: root,
        input: JSON.stringify({ cwd: root, hook_event_name: preEvent, tool_name: tool, tool_input: args }),
        env,
        encoding: "utf8",
        shell: true,
      }),
    run: (overrides: NodeJS.ProcessEnv = {}) =>
      spawnSync(command, { cwd: root, input, env: { ...env, ...overrides }, encoding: "utf8", shell: true }),
  };
}
