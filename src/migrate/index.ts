import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { builtInDetectors } from "../detectors/index.js";
import type { Finding, ScanResult } from "../domain.js";
import { scanRepository } from "../engine/index.js";
import { planFixReport } from "../fix/index.js";
import { OffingError } from "../offing-error.js";
import { buildReceipt } from "../receipt.js";
import { buildVerifyResult, identifyScan, VERIFY_RESULT_ARTIFACT } from "../verify-result.js";
import { VERSION } from "../version.js";
import type { AgentAdapter } from "./command-agent.js";
import { buildFindingPrompt } from "./prompt.js";
import { allowedChangePaths } from "./scope.js";
import { discardWorktree, git, prepareWorktree } from "./worktree.js";

interface MigrationOptions {
  path: string;
  findingId?: string;
  agent: AgentAdapter;
  timeoutMs: number;
}

export interface MigrationOutcome {
  findingId: string;
  branch: string;
  commit?: string;
  receiptPath?: string;
  resolved: boolean;
  error?: string;
}

const scan = (root: string): Promise<ScanResult> => scanRepository(root, builtInDetectors, { noCache: true });

async function cleanRepository(path: string): Promise<{ root: string; head: string }> {
  const root = (await git(["rev-parse", "--show-toplevel"], path).catch(() => "")).trim();
  if (!root) throw new OffingError("invalid-argument", "Agent migration needs a Git working tree.");
  if ((await git(["status", "--porcelain", "--untracked-files=all"], root)).trim()) {
    throw new OffingError(
      "invalid-argument",
      "Agent migration needs a clean working tree. Commit or stash changes first.",
    );
  }
  const head = (await git(["rev-parse", "--verify", "HEAD"], root)).trim();
  return { root, head };
}

async function selectFindings(scanned: ScanResult, findingId: string | undefined): Promise<Finding[]> {
  if (findingId !== undefined) {
    const finding = scanned.findings.find((candidate) => candidate.id === findingId);
    if (!finding) throw new OffingError("finding-not-found", `Scan did not find ${findingId}.`);
    return [finding];
  }
  const selected: Finding[] = [];
  for (const finding of scanned.findings) {
    // Ask fixers about one finding at a time. A patch for another finding in the same file proves nothing here.
    const report = await planFixReport({ ...scanned, findings: [finding] });
    if (report.patches.length === 0 || report.refusals.length > 0) selected.push(finding);
  }
  return selected;
}

function migrationBranch(findingId: string): string {
  const slug = findingId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 90);
  const suffix = createHash("sha256").update(findingId).digest("hex").slice(0, 10);
  return `offing/migrate/${slug}-${suffix}`;
}

async function recordMigration(
  root: string,
  worktree: string,
  branch: string,
  finding: Finding,
  before: ScanResult,
  affectedFiles: readonly string[],
): Promise<MigrationOutcome> {
  const after = { ...(await scan(worktree)), identity: { commit: null, offingVersion: VERSION } };
  const receipt = buildReceipt(before, after);
  const report = buildVerifyResult(receipt, before, after);
  const resolved = !after.findings.some(
    (candidate) => candidate.ruleId === finding.ruleId && candidate.location.path === finding.location.path,
  );
  const outcome = { findingId: finding.id, branch, resolved };
  await git(["add", "--all"], worktree);
  const changes = (await git(["diff", "--cached", "--no-renames", "--name-only", "-z"], worktree))
    .split("\0")
    .filter(Boolean);
  if (changes.length === 0) return { ...outcome, resolved: false, error: "The agent left no changes to commit." };
  const allowed = new Set(allowedChangePaths({ findingPath: finding.location.path, relatedPaths: affectedFiles }));
  const unrelated = changes.filter((file) => !allowed.has(file));
  if (unrelated.length > 0)
    return { ...outcome, resolved: false, error: `Agent changed paths outside the packet: ${unrelated.join(", ")}.` };
  const message = `chore: migrate ${finding.ruleId}\n\nOffing-Verify-Result: ${JSON.stringify(report)}\n`;
  await git(["-c", "commit.gpgSign=false", "commit", "--quiet", "--file=-"], worktree, message);
  const commit = (await git(["rev-parse", "HEAD"], worktree)).trim();
  await git(["branch", branch, commit], root);
  const reportDir = await mkdtemp(join(tmpdir(), "offing-migration-receipt-"));
  const receiptPath = join(reportDir, VERIFY_RESULT_ARTIFACT);
  await writeFile(receiptPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ...outcome, commit, receiptPath, resolved: resolved && report.introduced.length === 0 };
}

async function migrateFinding(
  repository: { root: string; head: string },
  finding: Finding,
  options: MigrationOptions,
): Promise<MigrationOutcome> {
  const branch = migrationBranch(finding.id);
  if ((await git(["branch", "--list", branch], repository.root)).trim()) {
    return {
      findingId: finding.id,
      branch,
      resolved: false,
      error: `Branch ${branch} already exists; review it first.`,
    };
  }
  const directory = await mkdtemp(join(tmpdir(), "offing-migrate-"));
  const worktree = join(directory, "checkout");
  try {
    await prepareWorktree(repository.root, repository.head, worktree);
    const before = await identifyScan(await scan(worktree));
    const { prompt, affectedFiles } = await buildFindingPrompt(before, finding.id, worktree);
    const instructions =
      "Leave edits uncommitted in this checkout. Do not publish or change other checkouts. Offing will rescan and record the local receipt.\n\n";
    const result = await options.agent.run({
      prompt: instructions + prompt,
      worktreePath: worktree,
      timeoutMs: options.timeoutMs,
      allowedPaths: allowedChangePaths({ findingPath: finding.location.path, relatedPaths: affectedFiles }),
    });
    if (result.exitCode !== 0) {
      const failure = result.timedOut
        ? "The agent command timed out."
        : `The agent command failed (${result.exitCode ?? result.signal}).`;
      const detail = result.stderr.trim();
      return { findingId: finding.id, branch, resolved: false, error: detail ? `${failure}\n${detail}` : failure };
    }
    if ((await git(["rev-parse", "HEAD"], worktree)).trim() !== repository.head) {
      return { findingId: finding.id, branch, resolved: false, error: "Agent commands must leave edits uncommitted." };
    }
    // The supplied agent edits the worktree. Offing rescans but does not run suggested checks.
    return await recordMigration(repository.root, worktree, branch, finding, before, affectedFiles);
  } finally {
    await discardWorktree(repository.root, worktree);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runMigrations(options: MigrationOptions): Promise<MigrationOutcome[]> {
  const repository = await cleanRepository(options.path);
  const findings = await selectFindings(await scan(repository.root), options.findingId);
  const outcomes: MigrationOutcome[] = [];
  for (const finding of findings) outcomes.push(await migrateFinding(repository, finding, options));
  return outcomes;
}
