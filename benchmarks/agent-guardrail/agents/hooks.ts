import { execFile, spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { readStdin } from "../../../src/agent-hooks/command.js";
import { pendingPatches, previewPatch } from "../../../src/agent-hooks/pending-patch.js";
import type { GuardrailTask } from "../validate.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
export const HOSTS = ["codex", "cursor"] as const;
export type Host = (typeof HOSTS)[number];
const traceName = "hooks.jsonl";
const preEvents = { codex: "PreToolUse", cursor: "preToolUse" };

interface HookTrace {
  input: string;
  stdout: string;
  stderr: string;
  status: number | null;
}

export async function installHooks(directory: string, host: Host) {
  const hostDirectory = host === "codex" ? ".codex" : ".cursor";
  await mkdir(join(directory, hostDirectory), { recursive: true });
  await exec(process.execPath, [cli, "init", "--hooks-for", host, directory], { cwd: directory });
  const config = JSON.parse(await readFile(join(directory, hostDirectory, "hooks.json"), "utf8")) as {
    hooks: Record<string, { command?: string; hooks?: { command: string }[] }[]>;
  };
  const entry = config.hooks[preEvents[host]]?.[0];
  const command = entry?.command ?? entry?.hooks?.[0]?.command;
  if (command !== `offing hook ${host}`) throw new Error(`Missing installed ${host} pre-write hook.`);
}

export async function prepareHookEnvironment(directory: string): Promise<NodeJS.ProcessEnv> {
  const bin = join(directory, "bin");
  await mkdir(bin);
  const proxy = fileURLToPath(import.meta.url);
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  await writeFile(join(bin, "offing"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(proxy)} "$@"\n`, {
    mode: 0o755,
  });
  return {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    OFFING_BENCHMARK_TRACE: join(directory, traceName),
    OFFING_CACHE_DIR: join(directory, "cache"),
    EBB_DATA_DIR: join(directory, "data"),
    OFFING_DATA_VERSION: "bundled",
    OFFING_NO_CACHE: "0",
  };
}

function runHookCli(args: string[], input: string): HookTrace {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", timeout: 15_000 });
  if (result.error) throw result.error;
  return { input, stdout: result.stdout, stderr: result.stderr, status: result.status };
}

export function replayHook(host: Host, cwd: string, task: GuardrailTask): HookTrace {
  const command = [
    "*** Begin Patch",
    `*** Add File: ${task.path}`,
    ...task.requested.split("\n").map((line) => `+${line}`),
    "*** End Patch",
  ].join("\n");
  const input = JSON.stringify({
    cwd,
    hook_event_name: preEvents[host],
    ...(host === "codex"
      ? { tool_name: "apply_patch", tool_input: { command } }
      : { tool_name: "Write", tool_input: { file_path: join(cwd, task.path), content: task.requested } }),
  });
  return runHookCli(["hook", host], input);
}

function requestedChange(input: string, cwd: string, task: GuardrailTask): boolean {
  const payload = JSON.parse(input) as { tool_input?: { command?: string; content?: string; file_path?: string } };
  const tool = payload.tool_input;
  if (tool?.command) {
    return pendingPatches(tool.command).some(
      (patch) =>
        patch.add &&
        resolve(cwd, patch.path) === join(cwd, task.path) &&
        previewPatch(patch, "")?.trim() === task.requested.trim(),
    );
  }
  return (
    (tool?.file_path === task.path || tool?.file_path === join(cwd, task.path)) &&
    tool?.content?.trim() === task.requested.trim()
  );
}

export function deniedRequestedEdit(trace: HookTrace, cwd: string, task: GuardrailTask): boolean {
  const denied = trace.status === 2 || /"permission"\s*:\s*"deny"/.test(trace.stdout);
  return denied && requestedChange(trace.input, cwd, task);
}

export async function readHookTraces(directory: string): Promise<HookTrace[]> {
  const text = await readFile(join(directory, traceName), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HookTrace);
}

/** Records the stock CLI's response while preserving stdin, stdout, stderr, and its exit code. */
async function proxy(args: string[]) {
  const trace = runHookCli(args, args[0] === "hook" ? await readStdin() : "");
  const destination = process.env.OFFING_BENCHMARK_TRACE;
  if (destination && args[0] === "hook") await appendFile(destination, `${JSON.stringify(trace)}\n`);
  process.stdout.write(trace.stdout);
  process.stderr.write(trace.stderr);
  process.exitCode = trace.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await proxy(process.argv.slice(2));
}
