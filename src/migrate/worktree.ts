import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function git(args: string[], cwd: string, input?: string): Promise<string> {
  const child = execute("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (input !== undefined) child.child.stdin?.end(input);
  try {
    return (await child).stdout;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)), { cause: error });
  }
}

export async function prepareWorktree(repositoryPath: string, commit: string, worktreePath: string): Promise<void> {
  try {
    await git(["cat-file", "-e", `${commit}^{commit}`], repositoryPath);
  } catch {
    throw new Error(
      `The repository at ${repositoryPath} does not contain ${commit}. Clone or fetch it before running the harness.`,
    );
  }
  await git(["worktree", "add", "--detach", worktreePath, commit], repositoryPath);
}

export async function discardWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
  try {
    await git(["worktree", "remove", "--force", worktreePath], repositoryPath);
  } catch {
    // The worktree may already be gone; the recursive removal below is the fallback.
  }
  await rm(worktreePath, { recursive: true, force: true });
}
