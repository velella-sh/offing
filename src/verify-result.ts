import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ScanIdentity, ScanResult } from "./domain.js";
import type { Receipt, ReceiptCounts, ReceiptFinding } from "./receipt.js";
import { VERSION } from "./version.js";

const execute = promisify(execFile);
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const VERIFY_RESULT_SCHEMA = "offing.verify-result.v1" as const;
export const VERIFY_RESULT_ARTIFACT = "offing-verify-result.json";
export const VERIFY_RESULT_INLINE_BYTES = 48 * 1024;
export const VERIFY_RESULT_MARKER = "<!-- offing-verify-result:v1 -->";

interface VerifyScanIdentity extends ScanIdentity {
  offingVersion: string | null;
  ebbDataVersion: string | null;
}

interface VerifyCommand {
  command: string;
  purpose: string;
  status: "not-run" | "passed" | "failed" | "skipped";
  exitCode: number | null;
  logSha256: string | null;
}

export interface VerifyResult {
  schemaVersion: typeof VERIFY_RESULT_SCHEMA;
  before: VerifyScanIdentity;
  after: VerifyScanIdentity;
  counts: ReceiptCounts;
  resolved: ReceiptFinding[];
  remaining: ReceiptFinding[];
  introduced: ReceiptFinding[];
  verdict: "passed" | "failed";
  commands: VerifyCommand[];
}

export function isGitCommit(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

/** Capture local HEAD while this side of the comparison is still checked out. */
export async function identifyScan(scan: ScanResult): Promise<ScanResult> {
  const commit = await execute("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: scan.root,
    timeout: 2000,
  }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
  return { ...scan, identity: { commit: isGitCommit(commit) ? commit : null, offingVersion: VERSION } };
}

function identity(scan: ScanResult): VerifyScanIdentity {
  return {
    commit: scan.identity?.commit ?? null,
    offingVersion: scan.identity?.offingVersion ?? null,
    ebbDataVersion: scan.data?.version || null,
  };
}

function sorted(findings: readonly ReceiptFinding[]): ReceiptFinding[] {
  return [...findings].sort((left, right) => compare(left.id, right.id));
}

/** Project the existing comparison into the verification contract, without reading a clock or executing checks. */
export function buildVerifyResult(receipt: Receipt, before: ScanResult, after: ScanResult): VerifyResult {
  return {
    schemaVersion: VERIFY_RESULT_SCHEMA,
    before: identity(before),
    after: identity(after),
    counts: receipt.counts,
    resolved: sorted(receipt.resolved),
    remaining: sorted(receipt.remaining),
    introduced: sorted(receipt.introduced),
    verdict: receipt.counts.remaining === 0 && receipt.counts.introduced === 0 ? "passed" : "failed",
    commands: [...receipt.commands]
      .sort((left, right) => compare(left.command, right.command))
      .map(({ command, purpose }) => ({ command, purpose, status: "not-run", exitCode: null, logSha256: null })),
  };
}

export function renderVerifyResultArtifactBlock(): string {
  return `${VERIFY_RESULT_MARKER}\nArtifact: \`${VERIFY_RESULT_ARTIFACT}\`\n`;
}

/** A bounded PR body block; the caller can attach the canonical JSON when it is too large to paste. */
export function renderVerifyResultBlock(result: VerifyResult): string {
  const json = JSON.stringify(result, null, 2);
  const fenced = "```json\n" + json + "\n```";
  if (Buffer.byteLength(fenced, "utf8") > VERIFY_RESULT_INLINE_BYTES) return renderVerifyResultArtifactBlock();
  return `${VERIFY_RESULT_MARKER}\n${fenced}\n`;
}
