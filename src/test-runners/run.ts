import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { parseJUnit, testKey, type FailedTest, type TestTotals } from "./junit.js";

type Command = readonly [executable: string, ...args: string[]];

interface Log {
  sha256: string;
  tail: string;
}

interface Attempt {
  exitCode: number | null;
  durationMs: number;
  status: "passed" | "failed" | "timed-out";
  totals: TestTotals | null;
  failures: FailedTest[];
  logs: { stdout: Log; stderr: Log };
}

interface TestRun {
  schemaVersion: "offing.test-run.v1";
  command: Command;
  attempts: [Attempt] | [Attempt, Attempt];
  flaky: FailedTest[];
}

interface Execution {
  exitCode: number | null;
  reports?: readonly string[];
}

/**
 * Caller-owned backend. It runs the approved argv in its isolated worktree with an explicit environment,
 * stops execution on abort, and resolves only after output and JUnit reports are final. This module launches
 * no local process and does not infer executable approval from repository metadata.
 */
type TestExecutor = (
  command: Command,
  output: { signal: AbortSignal; stdout(chunk: Uint8Array): void; stderr(chunk: Uint8Array): void },
) => Promise<Execution>;

const tailLimit = 4096;
const maxReports = 32;
const streamLimit = 8 * 1024 * 1024;

/** Receives one complete UTF-8 stream per attempt and returns the bytes admitted to evidence. */
export type TestLogFilter = (text: string) => string;

function captureLog() {
  const hash = createHash("sha256");
  let tail: Buffer = Buffer.alloc(0);
  return {
    write: (chunk: Uint8Array): void => {
      hash.update(chunk);
      const last = Buffer.from(chunk.subarray(-tailLimit));
      tail = Buffer.concat([tail.subarray(Math.max(0, tail.length + last.length - tailLimit)), last]);
    },
    finish(): Log {
      return { sha256: hash.digest("hex"), tail: tail.toString("utf8") };
    },
  };
}

function filterLog(filter?: TestLogFilter): ReturnType<typeof captureLog> {
  const log = captureLog();
  if (!filter) return log;
  const chunks: Buffer[] = [];
  let bytes = 0;
  return {
    write(chunk) {
      bytes += chunk.length;
      if (bytes > streamLimit) throw new Error("Test stream exceeds the proof capture limit.");
      chunks.push(Buffer.from(chunk));
    },
    finish() {
      log.write(Buffer.from(filter(Buffer.concat(chunks).toString("utf8"))));
      return log.finish();
    },
  };
}

function summarizeReports(reports: readonly string[], candidates: ReadonlySet<string>) {
  let totals: TestTotals | null = null;
  const failures: FailedTest[] = [];
  const repaired = new Set<string>();
  const stillFailing = new Set<string>();
  if (reports.length > maxReports) return { totals, failures, repaired };
  for (const report of reports) {
    const parsed = parseJUnit(report, candidates);
    if (!parsed) return { totals: null, failures: [], repaired: new Set<string>() };
    totals ??= { tests: 0, passed: 0, failed: 0, skipped: 0 };
    totals.tests += parsed.totals.tests;
    totals.passed += parsed.totals.passed;
    totals.failed += parsed.totals.failed;
    totals.skipped += parsed.totals.skipped;
    if (failures.length < 1000) failures.push(...parsed.failures.slice(0, 1000 - failures.length));
    for (const key of parsed.repaired) repaired.add(key);
    for (const key of parsed.stillFailing) stillFailing.add(key);
  }
  for (const key of stillFailing) repaired.delete(key);
  return { totals, failures, repaired };
}

async function runAttempt(
  command: Command,
  execute: TestExecutor,
  timeoutMs: number,
  candidates: ReadonlySet<string>,
  filter?: TestLogFilter,
): Promise<{ attempt: Attempt; repaired: Set<string> }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const stdout = filterLog(filter);
  const stderr = filterLog(filter);
  const start = performance.now();
  const execution = await execute(command, { signal, stdout: stdout.write, stderr: stderr.write }).catch(
    (error: unknown): Execution => {
      if (signal.aborted) return { exitCode: null };
      throw error;
    },
  );
  const durationMs = Math.round(performance.now() - start);
  const timedOut = signal.aborted || durationMs > timeoutMs;
  const { totals, failures, repaired } = summarizeReports(execution.reports ?? [], candidates);
  const status = timedOut ? "timed-out" : execution.exitCode === 0 && !totals?.failed ? "passed" : "failed";
  const attempt: Attempt = {
    exitCode: timedOut ? null : execution.exitCode,
    durationMs,
    status,
    totals,
    failures,
    logs: { stdout: stdout.finish(), stderr: stderr.finish() },
  };
  if (timedOut || execution.exitCode === null) repaired.clear();
  return { attempt, repaired };
}

/** Records an approved test command, retrying once within the caller's optional monotonic deadline. */
export async function runApprovedTest(
  command: Command,
  execute: TestExecutor,
  timeoutMs: number,
  deadline = Infinity,
  filter?: TestLogFilter,
): Promise<TestRun> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError("Test timeout must be an integer between 1 and 2147483647 milliseconds.");
  }
  const remaining = () => Math.max(1, Math.min(timeoutMs, Math.ceil(deadline - performance.now())));
  const { attempt: first } = await runAttempt(command, execute, remaining(), new Set(), filter);
  const result: TestRun = { schemaVersion: "offing.test-run.v1", command, attempts: [first], flaky: [] };
  if (first.status !== "failed" || first.exitCode === null || performance.now() >= deadline) return result;
  const { attempt: retry, repaired } = await runAttempt(
    command,
    execute,
    remaining(),
    new Set(first.failures.map(testKey)),
    filter,
  );
  result.attempts = [first, retry];
  result.flaky = first.failures.filter((failure) => repaired.has(testKey(failure)));
  return result;
}
