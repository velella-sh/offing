import { advanceRun, startRun } from "../autopilot/state.js";
import { isGitCommit } from "../verify-result.js";
import { readProofRange } from "./check.js";
import {
  checkedAutopilotRun,
  checkedProof,
  checkedVerifyResult,
  digest,
  invalid,
  MAX_LOG_BYTES,
  type Proof,
} from "./document.js";

/** Companion evidence for a terminal Autopilot run and the local Git repository it describes. */
export interface AutopilotProofEvidence extends Pick<Proof, "verify" | "testRuns" | "agentRuns" | "budget" | "tools"> {
  /** Local repository containing both recorded scan commits. */
  repo: string;
  /** Indices of planned verification commands and their corresponding recorded test runs. Null marks a deliberate skip. */
  commandResults: readonly { commandIndex: number; testRunIndex: number | null }[];
}

async function recordedRange(input: unknown, verify: Proof["verify"]) {
  const run = await checkedAutopilotRun(input);
  if (run.state !== "done" && run.state !== "stopped") throw invalid("Expected a terminal Autopilot run.");
  if (run.mode === "dry-run") throw invalid("A dry run cannot provide checkout or execution evidence.");
  if (run.transitions.length > 10_000) throw invalid("Autopilot run exceeds the transition limit.");
  const replay = startRun(run.mode);
  try {
    for (const phase of run.transitions.slice(1)) {
      advanceRun(replay, phase === "stopped" ? { stop: run.stopReason ?? "stopped" } : phase);
    }
  } catch {
    throw invalid("Autopilot run has an invalid transition sequence.");
  }
  if (replay.state !== run.state) throw invalid("Autopilot run state disagrees with its transitions.");
  if (run.checkout && run.checkout.branch !== `offing/autopilot/${run.checkout.id}`) {
    throw invalid("Autopilot checkout ID and branch do not match.");
  }
  const base = run.checkout?.baseCommit;
  const head = verify.after.commit;
  if (!isGitCommit(base) || !isGitCommit(head) || base !== verify.before.commit) {
    throw invalid("Autopilot checkout and verification scans must identify the same commit range.");
  }
  return { run, outcome: run.state, range: { base, head } };
}

function matchCommand(command: string, argv: readonly string[]): boolean {
  return (
    command === JSON.stringify(argv) ||
    (argv.every((arg) => /^[\w./:@%+=,-]+$/u.test(arg)) && command === argv.join(" "))
  );
}

function collectLogs(proof: Proof, source: ReadonlyMap<string, string>) {
  const logs = new Map<string, string>();
  let total = 0;
  const add = (sha256: string, text: string | undefined) => {
    if (logs.has(sha256)) return;
    if (typeof text !== "string") throw invalid("Test run source log is missing or inconsistent.");
    const size = Buffer.byteLength(text);
    total += size;
    if (size > MAX_LOG_BYTES || total > MAX_LOG_BYTES * 2)
      throw invalid("Autopilot proof exceeds the source log limits.");
    if (digest(text) !== sha256) throw invalid("Test run source log is missing or inconsistent.");
    logs.set(sha256, text);
  };
  for (const { attempts } of proof.testRuns) {
    for (const {
      logs: { stdout, stderr },
    } of attempts) {
      add(stdout.sha256, source.get(stdout.sha256));
      add(stderr.sha256, source.get(stderr.sha256));
    }
  }
  return { logs, add };
}

function applyExecution(
  command: Proof["verify"]["commands"][number],
  testRun: Proof["testRuns"][number] | undefined,
  source: ReturnType<typeof collectLogs>,
): void {
  const attempt = testRun?.attempts.at(-1);
  if (!testRun || !attempt || !matchCommand(command.command, testRun.command)) {
    throw invalid("Verification command does not match the linked test run argv.");
  }
  if (attempt.status === "timed-out" && attempt.exitCode !== null) {
    throw invalid("A timed-out test run cannot have an exit code.");
  }
  const failedTests = (attempt.totals?.failed ?? 0) > 0;
  if (attempt.status === "passed" && (attempt.exitCode !== 0 || failedTests)) {
    throw invalid("A passing test run must have a zero exit code and no reported failures.");
  }
  if (attempt.status === "failed" && attempt.exitCode === 0 && !failedTests) {
    throw invalid("A failed test run with a zero exit code must report failing tests.");
  }
  const { stdout, stderr } = attempt.logs;
  const combined = `[stdout]\n${source.logs.get(stdout.sha256)}\n[stderr]\n${source.logs.get(stderr.sha256)}`;
  const sha256 = digest(combined);
  source.add(sha256, combined);
  command.status = attempt.status === "passed" ? "passed" : "failed";
  command.exitCode = attempt.exitCode;
  command.logSha256 = sha256;
}

function commandLink(input: unknown): { commandIndex: number; testRunIndex: number | null } {
  if (!input || typeof input !== "object" || !("commandIndex" in input) || !("testRunIndex" in input)) {
    throw invalid("Invalid verification command link.");
  }
  const { commandIndex, testRunIndex } = input;
  if (typeof commandIndex !== "number" || !Number.isInteger(commandIndex)) {
    throw invalid("Expected an integer verification command index.");
  }
  if (testRunIndex !== null && (typeof testRunIndex !== "number" || !Number.isInteger(testRunIndex))) {
    throw invalid("Expected an integer test run index or a skip.");
  }
  return { commandIndex, testRunIndex };
}

function verificationEvidence(proof: Proof, bindings: unknown, source: ReturnType<typeof collectLogs>): void {
  const commands = proof.verify.commands;
  for (const command of commands) {
    command.status = "not-run";
    command.exitCode = command.logSha256 = null;
  }
  if (!Array.isArray(bindings) || bindings.length > commands.length)
    throw invalid("Invalid verification command links.");
  const linked = new Set<number>();
  const links: readonly unknown[] = bindings;
  for (const binding of links) {
    const { commandIndex, testRunIndex } = commandLink(binding);
    const command = commands[commandIndex];
    if (!command || linked.has(commandIndex)) throw invalid("Invalid or repeated verification command link.");
    linked.add(commandIndex);
    if (testRunIndex === null) {
      command.status = "skipped";
      continue;
    }
    applyExecution(command, proof.testRuns[testRunIndex], source);
  }
  const { remaining, introduced } = proof.verify.counts;
  proof.verify.verdict =
    remaining || introduced || commands.some(({ status }) => status === "failed") ? "failed" : "passed";
}

/** Build and reconcile the recorded evidence without executing repository commands. */
export async function buildAutopilotProof(
  input: unknown,
  evidence: AutopilotProofEvidence,
  logs: ReadonlyMap<string, string>,
) {
  if (!evidence || typeof evidence.repo !== "string" || evidence.repo === "") {
    throw invalid("Expected a local repository for the Autopilot proof.");
  }
  const verify = await checkedVerifyResult(evidence.verify);
  const { run, outcome, range } = await recordedRange(input, verify);
  const proof = structuredClone(
    await checkedProof({
      schemaVersion: "offing.proof.v1",
      outcome,
      range,
      verify,
      testRuns: evidence.testRuns,
      agentRuns: evidence.agentRuns,
      diff: await readProofRange(evidence.repo, range),
      budget: evidence.budget,
      tools: evidence.tools,
    }),
  );
  const turns = run.transitions.filter((phase) => phase === "agent-turn").length;
  if (proof.agentRuns.length !== turns) throw invalid("Agent results do not match the recorded Autopilot turns.");
  if (proof.testRuns.length > 0 && !run.transitions.some((phase) => phase === "baseline-tests" || phase === "tests")) {
    throw invalid("Test results require a recorded Autopilot test phase.");
  }
  const source = collectLogs(proof, logs);
  verificationEvidence(proof, evidence.commandResults, source);
  if (
    outcome === "done" &&
    (proof.verify.verdict === "failed" || !proof.verify.commands.some(({ status }) => status === "passed"))
  ) {
    throw invalid("A completed run requires passing verification and a passing recorded test.");
  }
  return { proof, logs: source.logs };
}
