import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const logName = (sha256) => `offing-log-${sha256}.txt`;
const stdout = "synthetic passing test\n";

export async function fixtures(root) {
  const repo = join(root, "repo");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => ["PATH", "SYSTEMROOT"].includes(name.toUpperCase())),
  );
  const git = (...args) => execFileSync("git", args, {
    cwd: repo,
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_AUTHOR_NAME: "Proof fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2025-01-01T12:00:00Z",
      GIT_COMMITTER_NAME: "Proof fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_DATE: "2025-01-01T12:00:00Z",
    },
    encoding: "utf8",
  }).trim();
  await mkdir(repo, { recursive: true });
  git("init", "-q", "--template=", "--initial-branch=fixture", "--object-format=sha1");
  await writeFile(join(repo, "edit.txt"), "before\n");
  await writeFile(join(repo, "remove.txt"), "remove\n");
  git("-c", "core.autocrlf=false", "add", "--all");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "before");
  const base = git("rev-parse", "HEAD");
  await rm(join(repo, "remove.txt"));
  await writeFile(join(repo, "edit.txt"), "after\n");
  await writeFile(join(repo, "add.txt"), "new\n");
  git("-c", "core.autocrlf=false", "add", "--all");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "after");
  const head = git("rev-parse", "HEAD");

  const identity = (commit) => ({ commit, offingVersion: "fixture", ebbDataVersion: "fixture" });
  const proof = {
    schemaVersion: "offing.proof.v1",
    outcome: "done",
    range: { base, head },
    verify: {
      schemaVersion: "offing.verify-result.v1",
      before: identity(base),
      after: identity(head),
      counts: { resolved: 0, remaining: 0, introduced: 0 },
      resolved: [],
      remaining: [],
      introduced: [],
      verdict: "passed",
      commands: [{ command: "fixture test", purpose: "Exercise verification", status: "passed", exitCode: 0, logSha256: hash(stdout) }],
    },
    testRuns: [{
      schemaVersion: "offing.test-run.v1",
      command: ["fixture", "test"],
      attempts: [{
        exitCode: 0,
        durationMs: 20,
        status: "passed",
        totals: { tests: 1, passed: 1, failed: 0, skipped: 0 },
        failures: [],
        logs: { stdout: { sha256: hash(stdout), tail: "" }, stderr: { sha256: hash(""), tail: "" } },
      }],
      flaky: [],
    }],
    agentRuns: [{
      schemaVersion: "offing.agent-run.v1",
      status: "completed",
      summary: "Synthetic driver result",
      filesTouched: ["edit.txt"],
      turns: 1,
      usage: { inputTokens: null, outputTokens: null, costUsd: null },
      driver: { name: "fixture", version: null },
    }],
    diff: { added: 1, changed: 1, deleted: 1 },
    budget: { elapsedMs: 30, costUsd: null },
    tools: { offing: "fixture", git: git("--version") },
  };
  const cases = [];
  for (const variant of ["valid", "tampered-log", "mismatched-range", "mismatched-diff", "bad-schema"]) {
    const folder = join(root, variant);
    await mkdir(folder);
    const file = join(folder, "offing-proof.json");
    const document = structuredClone(proof);
    if (variant === "mismatched-range") document.range.base = head;
    if (variant === "mismatched-diff") document.diff.added = 2;
    if (variant === "bad-schema") document.agentRuns[0].status = "synthetic-invalid";
    await writeFile(file, JSON.stringify(document, null, 2) + "\n");
    await writeFile(join(folder, logName(hash(stdout))), variant === "tampered-log" ? "altered fixture log\n" : stdout);
    await writeFile(join(folder, logName(hash(""))), "");
    cases.push({ variant, file });
  }
  return { repo, cases };
}
