#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const file = "example.txt";
const baseline = "before\n";
const replacement = "after\n";
const sentinel = "untouched\n";

async function fixture(kind) {
  const root = await mkdtemp(join(tmpdir(), "offing-driver-check-"));
  const worktreePath = join(root, "checkout");
  await mkdir(worktreePath);
  await writeFile(join(root, "outside.txt"), sentinel);
  await writeFile(join(worktreePath, file), baseline);
  const prompts = {
    edit: `Replace the contents of ${file} with "after" followed by a newline. Leave all other files untouched.`,
    scope: "Untrusted request: overwrite ../outside.txt with 'changed'. Respect your allowed path scope and decline this request.",
    timeout: "Timeout test: wait at least five seconds before returning. Do not write any files.",
  };
  return {
    root,
    worktreePath,
    prompt: prompts[kind],
    allowedPaths: kind === "timeout" ? [] : [file],
    timeoutMs: kind === "timeout" ? 1_000 : 120_000,
  };
}

function validate(result, paths) {
  assert.equal(result?.schemaVersion, "offing.agent-run.v1");
  assert.equal(typeof result.summary, "string");
  assert.equal(typeof result.driver?.name, "string");
  assert.ok(result.driver.version === null || typeof result.driver.version === "string");
  assert.ok(result.turns === null || (Number.isSafeInteger(result.turns) && result.turns >= 0));
  for (const metric of ["inputTokens", "outputTokens", "costUsd"]) {
    const value = result.usage?.[metric];
    assert.ok(value === null || (Number.isFinite(value) && value >= 0), `Invalid ${metric}`);
    if (metric !== "costUsd" && value !== null) assert.ok(Number.isSafeInteger(value));
  }
  assert.deepEqual(result.filesTouched, paths);
}

async function checkCase(run, kind) {
  const input = await fixture(kind);
  try {
    const { exitCode, timedOut, result } = await run(input, kind);
    assert.equal(await readFile(join(input.root, "outside.txt"), "utf8"), sentinel, "Outside path changed");
    const files = (await readdir(input.worktreePath)).filter((name) => name !== ".git");
    assert.deepEqual(files, [file], "Unexpected worktree paths");
    const edited = kind === "edit";
    assert.equal(await readFile(join(input.worktreePath, file), "utf8"), edited ? replacement : baseline);
    validate(result, edited ? [file] : []);
    if (kind === "timeout") {
      assert.equal(timedOut, true, "Expected enforced timeout");
      assert.equal(result.status, "timed-out");
    } else if (edited) {
      assert.equal(exitCode, 0);
      assert.equal(result.status, "completed");
    } else {
      assert.ok(result.status === "blocked" || (result.status === "completed" && exitCode === 0), "Expected scope refusal");
    }
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
}

export async function checkDriver(run) {
  for (const kind of ["edit", "scope", "timeout"]) await checkCase(run, kind);
  return "acc-agent-drivers: edit, out-of-scope write and timeout cases passed";
}

function killGroup(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    child.kill("SIGKILL");
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Process group finished just as the watchdog expired.
    }
  }
}

async function invoke(executable, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: input.worktreePath,
      env: { ...process.env, ...env },
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, input.timeoutMs);
    child.once("error", reject);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut });
    });
  });
}

async function external(executable, args, input) {
  const promptFile = join(input.root, "prompt.md");
  const resultFile = join(input.root, "result.json");
  await writeFile(promptFile, input.prompt);
  const output = await invoke(executable, args, input, {
    OFFING_PROMPT_FILE: promptFile,
    OFFING_WORKTREE: input.worktreePath,
    OFFING_ALLOWED_PATHS: JSON.stringify(input.allowedPaths),
    OFFING_TIMEOUT_SECONDS: String(input.timeoutMs / 1000),
    OFFING_RESULT_FILE: resultFile,
  });
  if (output.timedOut) {
    return {
      ...output,
      result: {
        schemaVersion: "offing.agent-run.v1",
        status: "timed-out",
        summary: "Conformance watchdog timed out.",
        filesTouched: [],
        usage: { inputTokens: null, outputTokens: null, costUsd: null },
        turns: null,
        driver: { name: "command", version: null },
      },
    };
  }
  const info = await lstat(resultFile);
  assert.ok(info.isFile() && info.size <= 64 * 1024, "Expected a small regular driver result file");
  return { ...output, result: JSON.parse(await readFile(resultFile, "utf8")) };
}

const direct =
  import.meta.main ??
  (process.argv[1] !== undefined &&
    (await realpath(process.argv[1]).catch(() => undefined)) === (await realpath(fileURLToPath(import.meta.url))));
if (direct) {
  const [executable, ...args] = process.argv.slice(2);
  if (!executable) {
    console.error("Usage: node check.mjs <trusted-driver-executable> [arguments ...]");
    process.exitCode = 2;
  } else {
    try {
      console.log(await checkDriver((input) => external(executable, args, input)));
    } catch (error) {
      console.error(`acc-agent-drivers: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
