import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { AgentResult } from "../agent-drivers/contract.js";
import { OffingError } from "../offing-error.js";
import { findPackageFile } from "../package-files.js";
import type { runApprovedTest } from "../test-runners/run.js";
import type { VerifyResult } from "../verify-result.js";

/** The v1 document that binds migration scan identities, Git path counts and redacted log digests. */
export interface Proof {
  schemaVersion: "offing.proof.v1";
  outcome: "done" | "stopped";
  range: { base: string; head: string };
  verify: VerifyResult;
  testRuns: Awaited<ReturnType<typeof runApprovedTest>>[];
  agentRuns: AgentResult[];
  diff: { added: number; changed: number; deleted: number };
  budget: { elapsedMs: number; costUsd: number | null };
  tools: { offing: string; git: string };
}

export const PROOF_FILE = "offing-proof.json";
export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
export const MAX_LOG_BYTES = 32 * 1024 * 1024;
export const digest = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
export const logName = (sha256: string): string => `offing-log-${sha256}.txt`;
export const invalid = (message: string): OffingError => new OffingError("invalid-input", message);
export const mismatch = (message: string): OffingError => new OffingError("policy-failed", message);

let validator: Promise<ValidateFunction<Proof>> | undefined;
async function loadValidator(): Promise<ValidateFunction<Proof>> {
  const ajv = new Ajv2020({ ownProperties: true, strictTuples: false });
  for (const stem of ["verify-result", "test-run", "agent-run", "proof"]) {
    const path = await findPackageFile(`schemas/${stem}.v1.schema.json`, import.meta.url);
    const schema: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!schema || typeof schema !== "object" || Array.isArray(schema))
      throw new Error("Expected a packaged proof schema.");
    ajv.addSchema(schema, stem);
  }
  const check = ajv.getSchema<Proof>("proof");
  if (!check) throw new Error("Expected packaged proof schema.");
  return check;
}

export async function checkedProof(value: unknown): Promise<Proof> {
  const check = await (validator ??= loadValidator());
  if (!check(value)) {
    const issue = check.errors?.[0];
    // An invalid input can put secret material in a property name. Report only the validation keyword.
    throw invalid(`Invalid proof schema (${issue?.keyword ?? "invalid document"}).`);
  }
  return value;
}

export function checkSummary({ range, verify }: Proof): void {
  if (verify.before.commit !== range.base || verify.after.commit !== range.head) {
    throw mismatch("Proof commit range does not match its scan identities.");
  }
  for (const kind of ["resolved", "remaining", "introduced"] as const) {
    if (verify.counts[kind] !== verify[kind].length) {
      throw mismatch(`Verification count disagrees with its ${kind} findings.`);
    }
  }
  for (const [index, command] of verify.commands.entries()) {
    if (!validCommandEvidence(command)) throw mismatch(`Inconsistent evidence for verification command ${index + 1}.`);
  }
  const failed =
    verify.remaining.length || verify.introduced.length || verify.commands.some(({ status }) => status === "failed");
  const verdict = failed ? "failed" : "passed";
  if (verify.verdict !== verdict) throw mismatch("Verification verdict disagrees with its findings.");
}

function validCommandEvidence({ status, exitCode, logSha256 }: VerifyResult["commands"][number]): boolean {
  if (status === "passed") return exitCode === 0 && logSha256 !== null;
  if (status === "failed") return exitCode !== null && exitCode > 0 && logSha256 !== null;
  return exitCode === null && logSha256 === null;
}

export function logEvidence(proof: Proof): Array<{ sha256: string; label: string }> {
  const logs: ReturnType<typeof logEvidence> = [];
  for (const [runIndex, run] of proof.testRuns.entries()) {
    for (const [attemptIndex, attempt] of run.attempts.entries()) {
      for (const stream of ["stdout", "stderr"] as const) {
        const label = `test run ${runIndex + 1} attempt ${attemptIndex + 1} ${stream}`;
        const { sha256, tail } = attempt.logs[stream];
        if (tail !== "") throw invalid(`Expected an empty log tail for ${label}.`);
        logs.push({ sha256, label });
      }
    }
  }
  for (const [index, command] of proof.verify.commands.entries()) {
    if (command.logSha256) logs.push({ sha256: command.logSha256, label: `verification command ${index + 1}` });
  }
  return logs;
}
