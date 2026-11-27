import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUTPUT_LIMIT = 8_000;
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

export interface AgentRunInput {
  prompt: string;
  worktreePath: string;
  timeoutMs: number;
}

export interface AgentRunOutput {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface AgentAdapter {
  name: string;
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}

export interface CommandAgentOptions {
  name?: string;
  command: string;
  env?: Record<string, string>;
}

export function truncate(value: string): string {
  if (value.length <= OUTPUT_LIMIT) return value;
  return `${value.slice(0, OUTPUT_LIMIT)}\n… (output truncated)`;
}

export function runShell(
  command: string,
  options: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<AgentRunOutput> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      detached: process.platform !== "win32",
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const bound = (value: string, chunk: string): string => (value + chunk).slice(0, OUTPUT_LIMIT + 1);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = bound(stdout, chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = bound(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => child.kill("SIGKILL"));
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group can exit just before the timer fires.
      }
    }, options.timeoutMs);
    child.once("error", (error) => {
      stderr = bound(stderr, error.message);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

/**
 * An adapter that runs a user-supplied command inside the worktree. The prompt is written to a temporary file
 * outside the worktree and its path is exported as `OFFING_MIGRATION_PROMPT_FILE`, so the command does not
 * have to embed a multi-line packet in argv.
 */
export function createCommandAgent(options: CommandAgentOptions): AgentAdapter {
  return {
    name: options.name ?? "command",
    async run(input) {
      const promptDirectory = await mkdtemp(join(tmpdir(), "offing-agent-prompt-"));
      const promptPath = join(promptDirectory, "prompt.md");
      await writeFile(promptPath, input.prompt, "utf8");
      try {
        const output = await runShell(options.command, {
          cwd: input.worktreePath,
          timeoutMs: input.timeoutMs,
          env: { ...options.env, OFFING_MIGRATION_PROMPT_FILE: promptPath },
        });
        return {
          ...output,
          stdout: truncate(output.stdout),
          stderr: truncate(output.stderr),
        };
      } finally {
        await rm(promptDirectory, { recursive: true, force: true });
      }
    },
  };
}
