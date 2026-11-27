import { rm } from "node:fs/promises";

import { addReviewDetails, reviewPrivateText, type ReviewEntry } from "./action-agent-review-details.js";
import {
  markAgentComment,
  publishAgentReview,
  type ReviewDraft,
  type ReviewEvent,
} from "./action-agent-review-store.js";
import { matchesAgentAuthor, parseAgentAuthors } from "./agent-pr.js";
import { daysBetween } from "./baseline.js";
import { git } from "./diff.js";
import type { Finding } from "./domain.js";
import { isRecord } from "./github-api-values.js";
import { changedLines, selectChangedAnnotations } from "./github-action/diff.js";
import type { GitHubActionOutcome } from "./github-action/types.js";
import { githubRequest, type PullRequestCommentTarget } from "./pr-comment.js";
import { required } from "./required.js";
import { escapeMarkdown } from "./reporters/shared.js";

interface AgentReviewPullRequest {
  number?: number;
  user?: { login?: string };
  base?: { sha?: string; repo?: { full_name?: string } };
  head?: { sha?: string; repo?: { full_name?: string } };
}

type Env = Record<string, string | undefined>;
const fullSha = /^[\da-f]{40}$/u;
const fullName = /^[\da-z-]+\/[\da-z._-]+$/iu;

export interface PostedReviewFindings {
  local: ReadonlySet<string>;
  repository: ReadonlySet<string>;
}

export interface AgentReviewReport {
  outcome: GitHubActionOutcome;
  posted?: PostedReviewFindings;
  packetDirectory?: string;
}

export function reviewFindingKey({ ruleId, location }: Finding, path = location.path): string {
  return JSON.stringify([ruleId, path, location.line]);
}

export function readAgentReviewEvent(env: Env): ReviewEvent | undefined {
  if (env["INPUT_AGENT-REVIEW"] !== "true") return undefined;
  const choice = env["INPUT_REVIEW-EVENT"] || "comment";
  if (choice === "comment") return "COMMENT";
  if (choice === "request-changes") return "REQUEST_CHANGES";
  throw new Error("review-event must be comment or request-changes.");
}

function verifiedBot(row: unknown, commits: ReadonlySet<string>, authors: ReadonlySet<string>): string | undefined {
  if (!isRecord(row) || typeof row.sha !== "string" || !commits.has(row.sha)) return undefined;
  const { committer, commit } = row;
  if (!isRecord(committer) || !isRecord(commit) || !isRecord(commit.verification)) return undefined;
  if (commit.verification.verified !== true || committer.type !== "Bot") return undefined;
  const login = committer.login;
  return typeof login === "string" && /^[-\da-z]+\[bot\]$/iu.test(login) && matchesAgentAuthor(login, authors)
    ? login
    : undefined;
}

export async function findCommitter(
  target: PullRequestCommentTarget,
  root: string,
  range: string,
  authors: ReadonlySet<string>,
): Promise<string | undefined> {
  const commits = new Set(git(root, ["rev-list", "--max-count=250", range, "--"]).toString("utf8").trim().split("\n"));
  const signal = AbortSignal.timeout(5_000);
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubRequest(
      target,
      "GET",
      `/repos/${target.repository}/pulls/${target.pullRequest}/commits?per_page=100&page=${page}`,
      undefined,
      signal,
    );
    if (!Array.isArray(batch)) return undefined;
    for (const row of batch) {
      const login = verifiedBot(row, commits, authors);
      if (login) return login;
    }
    if (batch.length < 100) break;
  }
  return undefined;
}

function safeText(value: string): string {
  return escapeMarkdown(value).replaceAll("@", "&#64;").replaceAll("~", "\\~");
}

function sourceLink(finding: Finding, isPrivate: (text: string) => boolean): string {
  for (const source of finding.sources) {
    if (isPrivate(source.url)) continue;
    try {
      const url = new URL(source.url);
      if (url.protocol === "https:" || url.protocol === "http:") return `<${url.href}>`;
    } catch {
      continue;
    }
  }
  return "Unavailable";
}

function deadlineLabel(today: string, deadline: string | undefined): string {
  if (!deadline) return "Unavailable";
  const days = daysBetween(today, deadline);
  if (!Number.isFinite(days)) return "Unavailable";
  return days < 0 ? `${-days} days overdue` : String(days);
}

function reviewEntries(
  outcome: Pick<GitHubActionOutcome, "result">,
  base: string,
  head: string,
  isPrivate: (text: string) => boolean,
) {
  const { root, scannedAt, findings } = outcome.result;
  const mergeBase = git(root, ["merge-base", base, head]).toString("utf8").trim();
  if (!fullSha.test(mergeBase)) return undefined;
  const changed = changedLines(root, `${mergeBase}..${head}`);
  const prefix = git(root, ["rev-parse", "--show-prefix"]).toString("utf8").trimEnd();
  const entries = selectChangedAnnotations(findings, changed).annotated.flatMap((finding): ReviewEntry[] => {
    const { path, line } = finding.location;
    if (line === undefined || isPrivate(prefix + path)) return [];
    return [
      {
        finding,
        comment: {
          path: prefix + path,
          line,
          side: "RIGHT",
          body: [
            isPrivate(finding.title) ? "Lifecycle finding" : safeText(finding.title),
            `Replacement: ${finding.replacement && !isPrivate(finding.replacement) ? safeText(finding.replacement) : "Unavailable"}`,
            `Source: ${sourceLink(finding, isPrivate)}`,
            `Days left: ${deadlineLabel(scannedAt.slice(0, 10), finding.deadline)}`,
          ].join("\n\n"),
        },
      },
    ];
  });
  return { changed, entries };
}

function targetFor(env: Env, pr: AgentReviewPullRequest | undefined): PullRequestCommentTarget | undefined {
  const repository = env.GITHUB_REPOSITORY;
  const token = env["INPUT_GITHUB-TOKEN"];
  const number = pr?.number;
  if (!repository || !fullName.test(repository) || pr?.base?.repo?.full_name !== repository) return undefined;
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !token || !number || !Number.isSafeInteger(number) || number < 1) {
    return undefined;
  }
  return { apiUrl: env.GITHUB_API_URL ?? "https://api.github.com", repository, pullRequest: number, token };
}

async function withCommitter(
  outcome: GitHubActionOutcome,
  target: PullRequestCommentTarget,
  pr: AgentReviewPullRequest | undefined,
  range: string,
  authors: ReadonlySet<string>,
): Promise<GitHubActionOutcome> {
  if (outcome.agent?.attribution?.signal === "author-login" || outcome.result.findings.length === 0) return outcome;
  try {
    const login = await findCommitter(target, outcome.result.root, range, authors);
    if (login) {
      return {
        ...outcome,
        agent: {
          author: pr?.user?.login ?? login,
          findings: outcome.result.findings,
          attribution: { signal: "bot-committer", login },
        },
      };
    }
  } catch {
    console.log(
      "::warning title=Offing could not verify agent committers::Check the GitHub pull-requests read permission.",
    );
  }
  return outcome;
}

function scanRange(outcome: GitHubActionOutcome, pr: AgentReviewPullRequest | undefined) {
  const base = pr?.base?.sha;
  const head = pr?.head?.sha;
  if (!base || !head || !fullSha.test(base) || !fullSha.test(head)) return undefined;
  return outcome.diff?.base === base && outcome.diff.head === head ? { base, head } : undefined;
}

/** Runs only in the Action host, after local scanning has finished. */
export async function reportAgentReview(
  outcome: GitHubActionOutcome,
  env: Env,
  pr: AgentReviewPullRequest | undefined,
  event: ReviewEvent | undefined,
): Promise<AgentReviewReport> {
  const verify = env["INPUT_VERIFY-AGENT-COMMITTERS"] === "true";
  if (!verify && !event) return { outcome };
  const authors = parseAgentAuthors(env["INPUT_AGENT-AUTHORS"]);
  const target = targetFor(env, pr);
  const revisions = scanRange(outcome, pr);
  if (!target || !revisions || authors.size === 0) return { outcome };
  const { base, head } = revisions;
  const canPost = event !== undefined && pr?.head?.repo?.full_name === target.repository;
  const attributed =
    verify || canPost ? await withCommitter(outcome, target, pr, `${base}..${head}`, authors) : outcome;
  if (canPost && (attributed.agent || attributed.result.findings.length === 0)) {
    return postAgentReview(attributed, target, event, base, head, env);
  }
  return { outcome: attributed };
}

export interface PreparedAgentReview {
  draft: ReviewDraft;
  posted?: PostedReviewFindings;
  packetDirectory?: string;
}

export async function prepareAgentReview(
  outcome: Pick<GitHubActionOutcome, "result">,
  event: ReviewEvent,
  base: string,
  head: string,
  env: Env,
): Promise<PreparedAgentReview | undefined> {
  const isPrivate = reviewPrivateText(env, outcome.result.root);
  const review = reviewEntries(outcome, base, head, isPrivate);
  if (!review) return undefined;
  if (review.entries.length === 0) return { draft: { base, head, event, comments: [] } };
  const details = await addReviewDetails(outcome.result, head, review.entries, review.changed, env, isPrivate);
  const comments = details.comments.map((comment, index) => {
    const { finding } = required(review.entries[index], "Agent review entry");
    return markAgentComment(comment, JSON.stringify([finding.ruleId, finding.location.column]));
  });
  const posted = {
    local: new Set(review.entries.map(({ finding }) => reviewFindingKey(finding))),
    repository: new Set(review.entries.map(({ finding, comment }) => reviewFindingKey(finding, comment.path))),
  };
  return {
    draft: { base, head, event, comments },
    posted,
    ...(details.packetDirectory ? { packetDirectory: details.packetDirectory } : {}),
  };
}

async function postAgentReview(
  outcome: GitHubActionOutcome,
  target: PullRequestCommentTarget,
  event: ReviewEvent,
  base: string,
  head: string,
  env: Env,
): Promise<AgentReviewReport> {
  let packetDirectory: string | undefined;
  try {
    const prepared = await prepareAgentReview(outcome, event, base, head, env);
    if (!prepared) return { outcome };
    packetDirectory = prepared.packetDirectory;
    await publishAgentReview(target, prepared.draft);
    return {
      outcome,
      ...(prepared.posted ? { posted: prepared.posted } : {}),
      ...(packetDirectory ? { packetDirectory } : {}),
    };
  } catch {
    if (packetDirectory) await rm(packetDirectory, { recursive: true, force: true }).catch(() => undefined);
    console.log(
      "::warning title=Offing could not post the agent review::Check the pull request head and token permissions.",
    );
    return { outcome };
  }
}
