import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunOutput } from "./process.js";

export interface AgentRunInput {
  prompt: string;
  worktreePath: string;
  timeoutMs: number;
  allowedPaths?: readonly string[];
}

export interface AgentUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface AgentResult {
  schemaVersion: "offing.agent-run.v1";
  status: "completed" | "failed" | "blocked" | "timed-out";
  summary: string;
  filesTouched: string[];
  turns: number | null;
  usage: AgentUsage;
  driver: { name: string; version: string | null };
}

export interface AgentAdapter {
  name: string;
  run(input: AgentRunInput): Promise<AgentRunOutput & { result?: AgentResult }>;
}

export interface AgentDriver {
  name: string;
  detect(): Promise<boolean>;
  version(): Promise<string | null>;
  run(input: AgentRunInput): Promise<AgentRunOutput & { result: AgentResult }>;
}

export const unknownUsage: Readonly<AgentUsage> = { inputTokens: null, outputTokens: null, costUsd: null };

export function makeResult(
  driver: AgentResult["driver"],
  output: AgentRunOutput,
  filesTouched: string[] = [],
  usage: AgentUsage = { ...unknownUsage },
  turns: number | null = null,
): AgentResult {
  const status = output.timedOut ? "timed-out" : output.exitCode === 0 ? "completed" : "failed";
  return {
    schemaVersion: "offing.agent-run.v1",
    status,
    summary: status === "completed" ? "Agent finished." : "Agent did not complete the task.",
    filesTouched,
    turns,
    usage,
    driver,
  };
}

export async function withRunFiles<T>(
  input: AgentRunInput,
  run: (files: { promptFile: string; resultFile: string; env: Record<string, string> }) => Promise<T>,
): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), "offing-agent-"));
  const promptFile = join(folder, "prompt.md");
  const resultFile = join(folder, "result.json");
  try {
    await writeFile(promptFile, input.prompt, "utf8");
    return await run({
      promptFile,
      resultFile,
      env: {
        OFFING_PROMPT_FILE: promptFile,
        OFFING_MIGRATION_PROMPT_FILE: promptFile,
        OFFING_WORKTREE: input.worktreePath,
        OFFING_ALLOWED_PATHS: JSON.stringify(input.allowedPaths ?? []),
        OFFING_TIMEOUT_SECONDS: String(Math.ceil(input.timeoutMs / 1000)),
        OFFING_RESULT_FILE: resultFile,
      },
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
