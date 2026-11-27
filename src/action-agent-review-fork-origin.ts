import { readFile } from "node:fs/promises";

import { positiveInteger, record } from "./github-api-values.js";
import { githubRequest, type PullRequestCommentTarget } from "./pr-comment.js";

export type ForkReviewEnv = Record<string, string | undefined>;
export const sha = /^[\da-f]{40}$/u;
const fullName = /^[\da-z-]+\/[\da-z._-]+$/iu;
const signalFile = "offing-agent-review-scan.yml";
const relativeSignalPath = ".github/workflows/" + signalFile;

type RecordValue = Record<string, unknown>;
interface Repository {
  id: number;
  name: string;
}

interface RunProvenance {
  id: number;
  attempt: number;
  workflow: number;
  repository: Repository;
  fork: Repository;
  head: string;
  branch: string;
}

export interface AuthorizedForkRun {
  target: PullRequestCommentTarget;
  run: number;
  attempt: number;
  base: string;
  head: string;
  author?: string;
}

function repository(value: unknown): Repository | undefined {
  const row = record(value);
  return row && positiveInteger(row.id) && typeof row.full_name === "string" && fullName.test(row.full_name)
    ? { id: row.id, name: row.full_name }
    : undefined;
}

function sameRepository(left: Repository | undefined, right: Repository): boolean {
  return left?.id === right.id && left.name === right.name;
}

function sameWorkflowPath(value: unknown): boolean {
  return typeof value === "string" && value.split("@", 1)[0] === relativeSignalPath;
}

function usableRun(row: RecordValue): boolean {
  return (
    row.event === "pull_request" &&
    row.status === "completed" &&
    row.conclusion === "success" &&
    sameWorkflowPath(row.path)
  );
}

function readRun(value: unknown, expected: Repository): RunProvenance | undefined {
  const row = record(value);
  if (!row || !usableRun(row)) return undefined;
  if (!positiveInteger(row.id) || !positiveInteger(row.run_attempt) || !positiveInteger(row.workflow_id))
    return undefined;
  const base = repository(row.repository);
  const fork = repository(row.head_repository);
  if (!sameRepository(base, expected) || !fork || fork.id === expected.id || fork.name === expected.name)
    return undefined;
  if (
    typeof row.head_sha !== "string" ||
    !sha.test(row.head_sha) ||
    typeof row.head_branch !== "string" ||
    !row.head_branch
  ) {
    return undefined;
  }
  return {
    id: row.id,
    attempt: row.run_attempt,
    workflow: row.workflow_id,
    repository: expected,
    fork,
    head: row.head_sha,
    branch: row.head_branch,
  };
}

function sameRun(a: RunProvenance, b: RunProvenance): boolean {
  return (
    a.id === b.id &&
    a.attempt === b.attempt &&
    a.workflow === b.workflow &&
    a.head === b.head &&
    a.branch === b.branch &&
    sameRepository(a.fork, b.fork)
  );
}

function matchOpenPullRequest(value: unknown, run: RunProvenance) {
  const row = record(value);
  if (!row || row.state !== "open" || row.draft !== false || !positiveInteger(row.number)) return undefined;
  const base = record(row.base);
  const head = record(row.head);
  if (!sameRepository(repository(base?.repo), run.repository) || !sameRepository(repository(head?.repo), run.fork)) {
    return undefined;
  }
  if (record(head?.repo)?.fork !== true || head?.ref !== run.branch || head.sha !== run.head) return undefined;
  if (typeof base?.sha !== "string" || !sha.test(base.sha)) return undefined;
  const login = record(row.user)?.login;
  return { number: row.number, base: base.sha, ...(typeof login === "string" && login ? { author: login } : {}) };
}

async function announcedForkRun(env: ForkReviewEnv) {
  const url = env.GITHUB_API_URL;
  const token = env["INPUT_GITHUB-TOKEN"];
  const eventPath = env.GITHUB_EVENT_PATH;
  const expected = repository({ id: Number(env.GITHUB_REPOSITORY_ID), full_name: env.GITHUB_REPOSITORY });
  if (env.GITHUB_EVENT_NAME !== "workflow_run" || !eventPath || !expected || !url || !token) return undefined;
  const envelope = record(JSON.parse(await readFile(eventPath, "utf8")));
  if (envelope?.action !== "completed" || !sameRepository(repository(envelope.repository), expected)) return undefined;
  const announced = readRun(envelope.workflow_run, expected);
  if (!announced) return undefined;
  const access = { apiUrl: url, token };
  const api = (path: string) =>
    githubRequest(access, "GET", `/repos/${expected.name}${path}`, undefined, AbortSignal.timeout(10_000));
  return { announced, access, api };
}

async function confirmedPullRequest(run: RunProvenance, api: (path: string) => Promise<unknown>) {
  const owner = run.fork.name.split("/", 1)[0];
  const candidates = await api(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${run.branch}`)}&per_page=100`);
  if (!Array.isArray(candidates) || candidates.length >= 100) return undefined;
  const matches = candidates.flatMap((candidate) => {
    const match = matchOpenPullRequest(candidate, run);
    return match ? [match] : [];
  });
  const first = matches[0];
  if (matches.length !== 1 || !first) return undefined;
  const confirmed = matchOpenPullRequest(await api(`/pulls/${first.number}`), run);
  if (confirmed?.number !== first.number || confirmed.base !== first.base) return undefined;
  return confirmed;
}

/** Infer the current PR solely from authenticated GitHub metadata. Fork workflow IDs and artifacts cannot name a PR. */
export async function authorizeForkRun(env: ForkReviewEnv): Promise<AuthorizedForkRun | undefined> {
  const stage = await announcedForkRun(env);
  if (!stage) return undefined;
  const { announced, access, api } = stage;
  const workflow = record(await api(`/actions/workflows/${signalFile}`));
  if (workflow?.id !== announced.workflow || workflow.state !== "active" || !sameWorkflowPath(workflow.path))
    return undefined;
  const run = readRun(await api(`/actions/runs/${announced.id}`), announced.repository);
  if (!run || !sameRun(run, announced)) return undefined;
  const confirmed = await confirmedPullRequest(run, api);
  if (!confirmed) return undefined;
  return {
    target: { ...access, repository: run.repository.name, pullRequest: confirmed.number },
    run: run.id,
    attempt: run.attempt,
    base: confirmed.base,
    head: run.head,
    ...(confirmed.author ? { author: confirmed.author } : {}),
  };
}
