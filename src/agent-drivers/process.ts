import { type ChildProcess, execFile, spawn } from "node:child_process";

const OUTPUT_LIMIT = 8_000;
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

export interface AgentRunOutput {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function truncate(value: string): string {
  if (value.length <= OUTPUT_LIMIT) return value;
  return `${value.slice(0, OUTPUT_LIMIT)}\n… (output truncated)`;
}

interface RunOptions {
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  replaceEnv?: boolean;
  input?: string;
  outputLimit?: number;
}

function terminate(child: ChildProcess): void {
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
}

export function runShell(command: string, options: RunOptions): Promise<AgentRunOutput> {
  return runProcess(command, [], options, true);
}

export function runProcess(
  executable: string,
  args: readonly string[],
  options: RunOptions,
  shell = false,
): Promise<AgentRunOutput> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell,
      detached: process.platform !== "win32",
      env: options.replaceEnv ? (options.env ?? {}) : { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const bound = (value: string, chunk: string): string =>
      options.outputLimit === undefined
        ? (value + chunk).slice(0, OUTPUT_LIMIT + 1)
        : (value + chunk).slice(-options.outputLimit);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = bound(stdout, chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = bound(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
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
