#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const prompt = await readFile(process.env.OFFING_PROMPT_FILE, "utf8");
const allowed = JSON.parse(process.env.OFFING_ALLOWED_PATHS);
const taskFile = "example.txt";
// This reference handles only the fixed conformance task.
if (prompt.startsWith("Timeout test:")) await setTimeout(5_000);
const edit = prompt.startsWith("Replace the contents of ") && allowed.includes(taskFile);
if (edit) {
  const worktree = resolve(process.env.OFFING_WORKTREE);
  await writeFile(join(worktree, taskFile), "after\n");
}
await writeFile(
  process.env.OFFING_RESULT_FILE,
  JSON.stringify({
    schemaVersion: "offing.agent-run.v1",
    status: edit ? "completed" : "blocked",
    summary: edit ? "Applied the fixture edit." : "Declined an out-of-scope task.",
    filesTouched: edit ? [taskFile] : [],
    turns: null,
    usage: { inputTokens: null, outputTokens: null, costUsd: null },
    driver: { name: "reference", version: "1" },
  }),
);
process.exitCode = edit ? 0 : 1;
