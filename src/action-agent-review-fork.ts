import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { findCommitter, prepareAgentReview, readAgentReviewEvent } from "./action-agent-review.js";
import { reviewPrivateText } from "./action-agent-review-details.js";
import {
  authorizeForkRun,
  sha,
  type AuthorizedForkRun,
  type ForkReviewEnv,
} from "./action-agent-review-fork-origin.js";
import { publishAgentReview, type ReviewDraft } from "./action-agent-review-store.js";
import { parseAgentAuthors } from "./agent-pr.js";
import { git } from "./diff.js";
import { positiveInteger, record } from "./github-api-values.js";
import { diffForkTrees, safeForkPath } from "./github-action/fork-snapshot.js";
import { scanInMode } from "./github-action/scan.js";
import type { SuggestionComment } from "./github-action/types.js";

const runGit = promisify(execFile);
const maxPlanBytes = 128_000;
const maxEncodedBytes = Math.ceil(maxPlanBytes / 3) * 4;

interface ForkReviewPlan {
  run: number;
  attempt: number;
  repository: string;
  pullRequest: number;
  draft: ReviewDraft;
}

function sourceOrigin(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
  if (url.protocol === "https:") return url.origin;
  // A local mock host can replay the object transport without ingesting real review data.
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") return url.origin;
  return undefined;
}

/** Populate Git objects in an empty private directory. Never check out a fork, use hooks, or load its config. */
async function fetchForkObjects(root: string, run: AuthorizedForkRun, env: ForkReviewEnv): Promise<void> {
  const origin = sourceOrigin(env.GITHUB_SERVER_URL);
  if (!origin) throw new Error("GitHub's repository origin is unavailable.");
  const auth = Buffer.from(`x-access-token:${run.target.token}`).toString("base64");
  const options = {
    cwd: root,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      PATH: env.PATH,
      SYSTEMROOT: env.SYSTEMROOT,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(root, "unused-global-git-config"),
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
      GIT_CONFIG_KEY_1: "http.followRedirects",
      GIT_CONFIG_VALUE_1: "false",
    },
  };
  await runGit("git", ["init", "--quiet", "--template="], options);
  await runGit(
    "git",
    [
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      `${origin}/${run.target.repository}.git`,
      `refs/pull/${run.target.pullRequest}/head:refs/offing/fork-head`,
      `${run.base}:refs/offing/fork-base`,
    ],
    options,
  );
  if (
    git(root, ["rev-parse", "refs/offing/fork-head"]).toString().trim() !== run.head ||
    git(root, ["rev-parse", "refs/offing/fork-base"]).toString().trim() !== run.base
  ) {
    throw new Error("The fetched fork refs changed before verification.");
  }
}

function encodePlan(plan: ForkReviewPlan): string {
  const json = Buffer.from(JSON.stringify(plan));
  if (json.byteLength > maxPlanBytes) throw new Error("The complete fork review plan exceeds the job output budget.");
  return json.toString("base64");
}

function planComment(value: unknown): value is SuggestionComment {
  const item = record(value);
  if (!item || !safeForkPath(item.path) || item.side !== "RIGHT" || !positiveInteger(item.line)) return false;
  if (
    typeof item.body !== "string" ||
    item.body.length > 16_000 ||
    !/^<!-- offing-agent-finding:[0-9a-f]{64} -->\n/u.test(item.body)
  )
    return false;
  if (item.start_line === undefined) return item.start_side === undefined;
  return positiveInteger(item.start_line) && item.start_line < item.line && item.start_side === "RIGHT";
}

function decodeDraft(value: unknown): ReviewDraft | undefined {
  const draft = record(value);
  if (draft?.event !== "COMMENT") return undefined;
  const { base, head, comments } = draft;
  if (typeof base !== "string" || !sha.test(base) || typeof head !== "string" || !sha.test(head)) return undefined;
  if (!Array.isArray(comments) || !comments.every(planComment)) return undefined;
  return { base, head, event: "COMMENT", comments };
}

function decodePlan(encoded: string | undefined): ForkReviewPlan | undefined {
  if (!encoded || encoded.length > maxEncodedBytes || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return undefined;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength > maxPlanBytes || bytes.toString("base64") !== encoded) return undefined;
  const plan = record(JSON.parse(bytes.toString("utf8")));
  const draft = decodeDraft(plan?.draft);
  if (
    !plan ||
    !draft ||
    !positiveInteger(plan.run) ||
    !positiveInteger(plan.attempt) ||
    !positiveInteger(plan.pullRequest) ||
    typeof plan.repository !== "string"
  )
    return undefined;
  return {
    run: plan.run,
    attempt: plan.attempt,
    repository: plan.repository,
    pullRequest: plan.pullRequest,
    draft,
  };
}

function expectedRun(plan: ForkReviewPlan, run: AuthorizedForkRun | undefined): run is AuthorizedForkRun {
  return (
    run !== undefined &&
    plan.run === run.run &&
    plan.attempt === run.attempt &&
    plan.repository === run.target.repository &&
    plan.pullRequest === run.target.pullRequest &&
    plan.draft.base === run.base &&
    plan.draft.head === run.head
  );
}

async function prepareForkReview(run: AuthorizedForkRun, env: ForkReviewEnv): Promise<string | undefined> {
  const authors = parseAgentAuthors(env["INPUT_AGENT-AUTHORS"]);
  if (authors.size === 0) return undefined;
  const root = await mkdtemp(join(tmpdir(), "offing-fork-review-"));
  try {
    await fetchForkObjects(root, run, env);
    const range = `${run.base}..${run.head}`;
    const outcome = await scanInMode(
      root,
      {
        root,
        reportPath: join(root, "unused-report.json"),
        mode: "diff",
        diffRange: range,
        failOnSeverity: "none",
        ...(run.author ? { pullRequestAuthor: run.author } : {}),
        ...(env["INPUT_AGENT-AUTHORS"] === undefined ? {} : { agentAuthors: env["INPUT_AGENT-AUTHORS"] }),
      },
      diffForkTrees,
    );
    if (
      outcome.result.findings.length > 0 &&
      !outcome.agent &&
      !(await findCommitter(run.target, root, range, authors))
    )
      return undefined;
    const review = await prepareAgentReview(outcome, "COMMENT", run.base, run.head, {
      ...env,
      GITHUB_RUN_ID: undefined,
    });
    if (!review) return undefined;
    return encodePlan({
      run: run.run,
      attempt: run.attempt,
      repository: run.target.repository,
      pullRequest: run.target.pullRequest,
      draft: review.draft,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function publishForkReview(plan: ForkReviewPlan, env: ForkReviewEnv): Promise<void> {
  const expected = await authorizeForkRun(env);
  if (!expectedRun(plan, expected)) return;
  const isPrivate = reviewPrivateText(env, "");
  if (plan.draft.comments.some(({ path, body }) => isPrivate(path) || isPrivate(body))) return;
  await publishAgentReview(expected.target, plan.draft, async () => {
    if (!expectedRun(plan, await authorizeForkRun(env))) throw new Error("Fork review provenance changed.");
  });
}

/** Called only by the explicitly enabled two-workflow fork template. The writer never opens a Git repository. */
export async function runForkReview(mode: string, env: ForkReviewEnv): Promise<string | undefined> {
  if (mode !== "prepare" && mode !== "publish") throw new Error("fork-review-mode must be off, prepare, or publish.");
  if (readAgentReviewEvent(env) !== "COMMENT")
    throw new Error("Fork review requires agent-review and review-event: comment.");
  if (mode === "publish") {
    const plan = decodePlan(env["INPUT_FORK-REVIEW-PLAN"]);
    if (plan) await publishForkReview(plan, env);
    return undefined;
  }
  const run = await authorizeForkRun(env);
  return run ? prepareForkReview(run, env) : undefined;
}
