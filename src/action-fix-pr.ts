/**
 * Keeps one pull request with every deterministic fix the fixers can apply. Everything before the
 * push is local: the scan and the patches never use the network. Only the push and the GitHub API
 * calls that create, update, or close the pull request leave the runner.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { builtInDetectors } from "./detectors/index.js";
import type { ScanResult } from "./domain.js";
import { scanRepository } from "./engine/index.js";
import { planFixReport, renderPatches } from "./fix/index.js";
import type { FilePatch } from "./fix/index.js";
import { FIX_COMMIT_MESSAGE } from "./fix/git.js";
import { FIX_PR_PATCH, FIX_PR_PLAN, renderFixPullRequestBody } from "./fix-pr-body.js";
import { buildReceipt } from "./receipt.js";
import { buildVerifyResult, identifyScan, VERIFY_RESULT_ARTIFACT, type VerifyResult } from "./verify-result.js";
import type { FixPlan } from "./fix/index.js";

const execute = promisify(execFile);

/** The branch the fix pull request lives on. The pull request is found by this head. */
export const FIX_PR_BRANCH = "offing/fixes";
export const FIX_PR_TITLE = "Offing: apply deterministic lifecycle fixes";

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

export interface FixPullRequestTarget {
  /** The scanned repository root; the scan result's root is used when this is left out. */
  root?: string;
  /** owner/name */
  repository: string;
  token: string;
  /** API origin, for example https://api.github.com. */
  apiUrl?: string;
  /** The branch the pull request targets, normally the repository's default branch. */
  baseBranch: string;
  /** The branch the fixes are committed to; defaults to `offing/fixes`. */
  branch?: string;
  /** Add the "Scanned by Offing" line to the pull request body (default true). */
  attribution?: boolean;
  labels?: readonly string[];
  artifactRoot?: string;
  artifactUrl?: string;
}

export type FixPullRequestStatus = "opened" | "updated" | "closed" | "nothing" | "protected";

export interface FixPullRequestOutcome {
  status: FixPullRequestStatus;
  /** How many findings the applied patches resolved. */
  fixes: number;
  number?: number;
  url?: string;
  artifactPath?: string;
  labelFailure?: string;
}

interface GitHubTarget {
  apiUrl: string;
  repository: string;
  token: string;
}

interface PullRequest {
  number: number;
  state: "open" | "closed";
  merged_at?: string | null;
  html_url?: string;
  head?: { ref?: string; repo?: { full_name?: string } };
}

async function githubRequest(target: GitHubTarget, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${target.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${target.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed with ${response.status}`);
  return response.json();
}

/** The one pull request whose head is the fixes branch, open or closed, so a re-run updates it instead of adding another. */
async function findPullRequest(target: GitHubTarget, branch: string): Promise<PullRequest | undefined> {
  const owner = target.repository.split("/")[0] ?? "";
  const query = new URLSearchParams({
    state: "all",
    head: `${owner}:${branch}`,
    sort: "created",
    direction: "desc",
    per_page: "100",
  });
  const pulls = (await githubRequest(
    target,
    "GET",
    `/repos/${target.repository}/pulls?${query.toString()}`,
  )) as PullRequest[];
  const ours = pulls.filter(
    (pull) =>
      pull.head?.ref === branch && (!pull.head.repo?.full_name || pull.head.repo.full_name === target.repository),
  );
  return ours.find((pull) => pull.state === "open") ?? ours[0];
}

async function git(root: string, args: string[], input?: string): Promise<string> {
  const child = execute("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (input !== undefined) child.child.stdin?.end(input);
  try {
    return (await child).stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error as Error).message);
  }
}

/** Commits the patches on the fixes branch. The runner's checkout is clean, so a dirty tree means something else is wrong. */
async function applyFixesOnBranch(root: string, branch: string, patches: FilePatch[]): Promise<void> {
  if ((await git(root, ["status", "--porcelain", "--untracked-files=all"])).trim() !== "") {
    throw new Error("fix-pr needs a clean working tree; the checkout has uncommitted changes.");
  }
  const files = [...new Set(patches.map((patch) => patch.path))].sort();
  await git(root, ["checkout", "-q", "-B", branch]);
  await git(root, ["apply", "--whitespace=nowarn", "-"], renderPatches(patches));
  await git(root, ["add", "--", ...files]);
  await git(root, [
    "-c",
    `user.name=${BOT_NAME}`,
    "-c",
    `user.email=${BOT_EMAIL}`,
    "commit",
    "-q",
    "-m",
    FIX_COMMIT_MESSAGE,
  ]);
}

interface RemoteBranch {
  sha: string;
  botOwned: boolean;
}

const BOT_COMMIT = [BOT_NAME, BOT_EMAIL, BOT_NAME, BOT_EMAIL, FIX_COMMIT_MESSAGE].join("\t");
const BRANCH_NOTE =
  "Offing left this branch alone because it contains commits it cannot identify as its own. Review the branch before running the fix workflow again.";

async function isShallow(root: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
}

async function inspectRemoteBranch(root: string, branch: string): Promise<RemoteBranch> {
  const ref = `refs/heads/${branch}`;
  const output = await git(root, ["ls-remote", "--refs", "origin", ref]);
  const sha = output.trim().split("\t")[0] ?? "";
  if (sha === "") return { sha, botOwned: true };
  // Without the complete history an unseen commit could belong to a contributor.
  if (await isShallow(root)) {
    await git(root, ["fetch", "--unshallow", "--no-tags", "origin"]);
    if (await isShallow(root)) return { sha, botOwned: false };
  }
  await git(root, ["fetch", "--no-tags", "origin", ref]);
  if ((await git(root, ["rev-parse", "FETCH_HEAD"])).trim() !== sha) {
    throw new Error("The fix branch changed during inspection. Retry the workflow.");
  }
  const commits = await git(root, ["log", "--format=%an%x09%ae%x09%cn%x09%ce%x09%s", `HEAD..${sha}`]);
  return {
    sha,
    botOwned: commits
      .split(/\r?\n/)
      .filter(Boolean)
      .every((commit) => commit === BOT_COMMIT),
  };
}

async function pushBranch(root: string, branch: string, remote: RemoteBranch): Promise<void> {
  const ref = `refs/heads/${branch}`;
  await git(root, ["push", `--force-with-lease=${ref}:${remote.sha}`, "origin", `HEAD:${ref}`]);
}

async function protectBranch(github: GitHubTarget, existing?: PullRequest): Promise<FixPullRequestOutcome> {
  if (existing?.state === "open") {
    await githubRequest(github, "POST", `/repos/${github.repository}/issues/${existing.number}/comments`, {
      body: BRANCH_NOTE,
    });
  }
  return { status: "protected", fixes: 0 };
}

/** With no fixes left, closes the open fix pull request, if its branch is still bot-owned. */
async function closeStaleFixPullRequest(
  github: GitHubTarget,
  root: string,
  branch: string,
): Promise<FixPullRequestOutcome> {
  const existing = await findPullRequest(github, branch);
  if (existing?.state === "open") {
    if (!(await inspectRemoteBranch(root, branch)).botOwned) return protectBranch(github, existing);
    await githubRequest(github, "PATCH", `/repos/${github.repository}/pulls/${existing.number}`, { state: "closed" });
    return {
      status: "closed",
      fixes: 0,
      number: existing.number,
      ...(existing.html_url ? { url: existing.html_url } : {}),
    };
  }
  return { status: "nothing", fixes: 0 };
}

/** Updates (or reopens) the fix pull request for the branch, or opens a new one. */
async function upsertFixPullRequest(
  github: GitHubTarget,
  target: FixPullRequestTarget,
  branch: string,
  body: string,
  fixes: number,
  existing: PullRequest | undefined,
): Promise<FixPullRequestOutcome> {
  // A closed pull request is reopened, but a merged one cannot be: the next run opens a new pull request instead.
  if (existing && (existing.state === "open" || !existing.merged_at)) {
    await githubRequest(github, "PATCH", `/repos/${github.repository}/pulls/${existing.number}`, {
      title: FIX_PR_TITLE,
      body,
      ...(existing.state === "open" ? {} : { state: "open" }),
    });
    return {
      status: "updated",
      fixes,
      number: existing.number,
      ...(existing.html_url ? { url: existing.html_url } : {}),
    };
  }

  const created = (await githubRequest(github, "POST", `/repos/${github.repository}/pulls`, {
    title: FIX_PR_TITLE,
    head: branch,
    base: target.baseBranch,
    body,
  })) as { number: number; html_url?: string };
  return {
    status: "opened",
    fixes,
    number: created.number,
    ...(created.html_url ? { url: created.html_url } : {}),
  };
}

async function applyLabels(
  github: GitHubTarget,
  number: number | undefined,
  labels?: readonly string[],
): Promise<string | undefined> {
  if (number === undefined || !labels?.length) return undefined;
  try {
    await githubRequest(github, "POST", `/repos/${github.repository}/issues/${number}/labels`, { labels });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function writeArtifacts(root: string, verification: VerifyResult, plan: FixPlan): Promise<string> {
  const directory = await mkdtemp(join(root, "offing-fix-pr-"));
  await Promise.all([
    writeFile(join(directory, VERIFY_RESULT_ARTIFACT), JSON.stringify(verification, null, 2) + "\n"),
    writeFile(join(directory, FIX_PR_PATCH), renderPatches(plan.patches)),
    writeFile(
      join(directory, FIX_PR_PLAN),
      JSON.stringify(
        {
          patches: plan.patches.map(({ fixer, path }) => ({ fixer, path })),
          refusals: plan.refusals,
        },
        null,
        2,
      ) + "\n",
    ),
  ]);
  return directory;
}

export async function publishFixPullRequest(
  result: ScanResult,
  target: FixPullRequestTarget,
): Promise<FixPullRequestOutcome> {
  const root = target.root ?? result.root;
  const branch = target.branch ?? FIX_PR_BRANCH;
  const github: GitHubTarget = {
    apiUrl: target.apiUrl ?? "https://api.github.com",
    repository: target.repository,
    token: target.token,
  };
  const plan = await planFixReport(result);
  if (plan.patches.length === 0) return closeStaleFixPullRequest(github, root, branch);

  const remote = await inspectRemoteBranch(root, branch);
  const existing = await findPullRequest(github, branch);
  if (!remote.botOwned) return protectBranch(github, existing);
  const before = await identifyScan(result);
  await applyFixesOnBranch(root, branch, plan.patches);
  const after = await identifyScan(await scanRepository(root, builtInDetectors));
  const receipt = buildReceipt(before, after);
  const verification = buildVerifyResult(receipt, before, after);
  const resolved = new Set(receipt.resolved.map(({ id }) => id));
  const body = renderFixPullRequestBody({
    fixed: before.findings.filter(({ id }) => resolved.has(id)),
    patches: plan.patches,
    refusals: plan.refusals,
    receipt,
    verification,
    attribution: target.attribution ?? true,
    ...(target.artifactUrl ? { artifactUrl: target.artifactUrl } : {}),
  });
  const artifactPath = target.artifactRoot ? await writeArtifacts(target.artifactRoot, verification, plan) : undefined;
  await pushBranch(root, branch, remote);
  const done = await upsertFixPullRequest(github, target, branch, body, resolved.size, existing);
  const labelFailure = await applyLabels(github, done.number, target.labels);
  return {
    ...done,
    ...(artifactPath ? { artifactPath } : {}),
    ...(labelFailure ? { labelFailure } : {}),
  };
}

type Environment = Record<string, string | undefined>;

interface ActionReporting {
  commandValue(value: string): string;
  setOutput(name: string, value: string): Promise<void>;
  writeSummary(body: string): Promise<void>;
}

function fixPublicationSkip(env: Environment, baseBranch: string, fork: boolean): string | undefined {
  const eventName = env.GITHUB_EVENT_NAME;
  if (fork) return "Fix pull requests are skipped for forks.";
  if (eventName !== "schedule" && eventName !== "workflow_dispatch") {
    return `fix-pr runs on schedule and workflow_dispatch events; this run is ${eventName ?? "not a GitHub Actions event"}.`;
  }
  const ref = env.GITHUB_REF;
  if (ref && ref !== `refs/heads/${baseBranch}`) return "Run the workflow from the repository default branch.";
  return undefined;
}

function fixPublicationMessage(done: FixPullRequestOutcome): string {
  switch (done.status) {
    case "protected":
      return "Offing left the fix branch alone because it could not verify that every commit was bot-owned.";
    case "nothing":
      return "Offing found no deterministic fixes; it opened no pull request and had none to close.";
    case "closed":
      return `Offing closed fix pull request #${done.number}: nothing is left to fix.`;
    default:
      return `Offing ${done.status} fix pull request #${done.number} with ${done.fixes} deterministic fix${done.fixes === 1 ? "" : "es"}.`;
  }
}

function fixPublicationFailure(message: string): string {
  if (/protected branch|branch protection|denying non-fast-forward|GH006|GH013/i.test(message)) {
    return "Branch protection rejected the fix branch update. Offing left the pull request alone.";
  }
  if (/\b40[13]\b|permission|not authorized|access denied/i.test(message)) {
    return "The token or checkout credentials did not grant the writes needed for the fix pull request.";
  }
  return "Offing could not publish the fix pull request. See the job log for the operation that failed.";
}

function fixPublicationTarget(env: Environment, root: string, baseBranch: string): FixPullRequestTarget | undefined {
  const token = env["INPUT_GITHUB-TOKEN"];
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !repository) return undefined;
  const artifactUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID}#artifacts`
      : undefined;
  return {
    root,
    repository,
    token,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    baseBranch,
    attribution: env.INPUT_ATTRIBUTION !== "false",
    labels: [
      ...new Set(
        (env["INPUT_FIX-PR-LABELS"] ?? "")
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    ],
    artifactRoot: env.RUNNER_TEMP || tmpdir(),
    ...(artifactUrl ? { artifactUrl } : {}),
  };
}

function summary(reporting: ActionReporting, message: string): Promise<void> {
  return reporting.writeSummary(`\n### Offing fix pull request\n\n${message.replace(/[\r\n]+/g, " ")}\n`);
}

async function reportFixPublication(done: FixPullRequestOutcome, reporting: ActionReporting): Promise<void> {
  const message = fixPublicationMessage(done);
  console.log(message);
  if (done.labelFailure) {
    console.log(
      `::warning title=Offing could not add the fix pull request labels::${reporting.commandValue(done.labelFailure)}`,
    );
  }
  await summary(reporting, message + (done.labelFailure ? " The requested labels could not be added." : ""));
}

/** A publication failure warns and records a reason without changing the scan outcome. */
export async function publishActionFixes(
  result: ScanResult,
  env: Environment,
  repository: { default_branch?: string; fork?: boolean } | undefined,
  fork: boolean,
  reporting: ActionReporting,
): Promise<void> {
  if (env["INPUT_FIX-PR"] !== "true") return;
  const baseBranch = repository?.default_branch || env.GITHUB_REF_NAME || "main";
  const skipped = fixPublicationSkip(env, baseBranch, fork || repository?.fork === true);
  const target = fixPublicationTarget(env, result.root, baseBranch);
  if (skipped || !target) {
    const reason = skipped ?? "fix-pr needs a token and GITHUB_REPOSITORY.";
    console.log(`::notice title=Offing fix pull request skipped::${reporting.commandValue(reason)}`);
    await summary(reporting, reason);
    return;
  }
  try {
    const done = await publishFixPullRequest(result, target);
    if (done.artifactPath) await reporting.setOutput("fix-pr-artifact-path", done.artifactPath);
    if (done.number !== undefined) await reporting.setOutput("fix-pr-number", String(done.number));
    if (done.url) await reporting.setOutput("fix-pr-url", done.url);
    await reportFixPublication(done, reporting);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::warning title=Offing could not publish the fix pull request::${reporting.commandValue(message)}`);
    await summary(reporting, fixPublicationFailure(message));
  }
}
