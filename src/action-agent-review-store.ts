import { createHash } from "node:crypto";

import type { SuggestionComment } from "./github-action/types.js";
import { record } from "./github-api-values.js";
import { githubRequest, type PullRequestCommentTarget } from "./pr-comment.js";

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES";

export interface ReviewDraft {
  base: string;
  head: string;
  event: ReviewEvent;
  comments: readonly SuggestionComment[];
}

const reviewMarker = "<!-- offing-agent-review -->";
const commentMarker = /^<!-- offing-agent-finding:([0-9a-f]{64}) -->\n/u;
const timeout = () => AbortSignal.timeout(10_000);

const repositoryQuery = `query OffingAgentReview($owner: String!, $repository: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repository) {
    pullRequest(number: $number) {
      state baseRefOid headRefOid
      reviews(last: 50) { nodes { body state viewerDidAuthor author { __typename } } }
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id path line startLine diffSide isOutdated isResolved viewerCanResolve
          comments(first: 1) { nodes { id body viewerDidAuthor viewerCanUpdate replyTo { id } author { __typename } } }
        }
      }
    }
  }
}`;

const currentQuery = `query OffingAgentReviewHead($owner: String!, $repository: String!, $number: Int!) {
  repository(owner: $owner, name: $repository) { pullRequest(number: $number) { state baseRefOid headRefOid } }
}`;

const updateComment = `mutation OffingUpdateAgentReview($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: {pullRequestReviewCommentId: $id, body: $body}) {
    pullRequestReviewComment { id }
  }
}`;

const resolveThread = `mutation OffingResolveAgentThread($id: ID!) {
  resolveReviewThread(input: {threadId: $id}) { thread { id } }
}`;

type RecordValue = Record<string, unknown>;
async function graphql(target: PullRequestCommentTarget, query: string, variables: RecordValue): Promise<RecordValue> {
  const enterprise = target.apiUrl.endsWith("/api/v3");
  const base = enterprise ? { ...target, apiUrl: target.apiUrl.slice(0, -3) } : target;
  const reply = record(await githubRequest(base, "POST", "/graphql", { query, variables }, timeout()));
  const data = record(reply?.data);
  if (!data || reply?.errors !== undefined) throw new Error("GitHub could not confirm agent review ownership.");
  return data;
}

function requestVariables(target: PullRequestCommentTarget): RecordValue {
  const [owner, repository] = target.repository.split("/");
  return { owner, repository, number: target.pullRequest };
}

function requireCurrent(data: RecordValue, draft: ReviewDraft): RecordValue {
  const pr = record(record(data.repository)?.pullRequest);
  if (pr?.state !== "OPEN" || pr.headRefOid !== draft.head || pr.baseRefOid !== draft.base) {
    throw new Error("The pull request changed before Agent review publication.");
  }
  return pr;
}

function owned(candidate: RecordValue): boolean {
  return candidate.viewerDidAuthor === true && record(candidate.author)?.__typename === "Bot";
}

interface ManagedThread {
  id: string;
  commentId: string;
  body: string;
  key?: string;
  canUpdate: boolean;
  canResolve: boolean;
}

function anchorKey(path: unknown, body: string, line: unknown, start: unknown): string | undefined {
  const mark = commentMarker.exec(body)?.[1];
  if (!mark || typeof path !== "string" || typeof line !== "number") return undefined;
  return JSON.stringify([mark, path, start ?? line, line]);
}

export function markAgentComment(comment: SuggestionComment, ruleId: string): SuggestionComment {
  const marker = createHash("sha256").update(ruleId).digest("hex");
  return { ...comment, body: `<!-- offing-agent-finding:${marker} -->\n${comment.body}` };
}

function managedThread(value: unknown): ManagedThread | undefined {
  const thread = record(value);
  const comments = record(thread?.comments)?.nodes;
  if (!thread || !Array.isArray(comments)) throw new Error("Incomplete GitHub review thread data.");
  const comment = record(comments[0]);
  if (!comment || !owned(comment) || comment.replyTo !== null) return undefined;
  const { body, id: commentId } = comment;
  if (typeof body !== "string" || !commentMarker.test(body)) return undefined;
  if (typeof thread.id !== "string" || typeof commentId !== "string") throw new Error("Missing GitHub review IDs.");
  const key =
    thread.diffSide === "RIGHT" && thread.isOutdated === false
      ? anchorKey(thread.path, body, thread.line, thread.startLine)
      : undefined;
  return {
    id: thread.id,
    commentId,
    body,
    ...(key ? { key } : {}),
    canUpdate: comment.viewerCanUpdate === true,
    canResolve: thread.isResolved === false && thread.viewerCanResolve === true,
  };
}

function latestOwnReviewRequestsChanges(pr: RecordValue): boolean {
  const reviews = record(pr.reviews)?.nodes;
  if (!Array.isArray(reviews)) throw new Error("Missing GitHub Agent review decision data.");
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    const review = record(reviews[index]);
    if (review && owned(review) && typeof review.body === "string" && review.body.startsWith(reviewMarker)) {
      return review.state === "CHANGES_REQUESTED";
    }
  }
  return false;
}

async function existingReviews(target: PullRequestCommentTarget, draft: ReviewDraft) {
  const threads: ManagedThread[] = [];
  let cursor: string | null = null;
  let requestedChanges = false;
  for (let page = 0; page < 20; page += 1) {
    const data = await graphql(target, repositoryQuery, { ...requestVariables(target), cursor });
    const pr = requireCurrent(data, draft);
    if (page === 0 && draft.event === "REQUEST_CHANGES") requestedChanges = latestOwnReviewRequestsChanges(pr);
    const collection = record(pr.reviewThreads);
    const pageInfo = record(collection?.pageInfo);
    if (!Array.isArray(collection?.nodes) || typeof pageInfo?.hasNextPage !== "boolean") break;
    for (const candidate of collection.nodes) {
      const thread = managedThread(candidate);
      if (thread) threads.push(thread);
    }
    if (!pageInfo.hasNextPage) return { threads, requestedChanges };
    if (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor === cursor) break;
    cursor = pageInfo.endCursor;
  }
  throw new Error("The complete Agent review inventory is unavailable.");
}

async function updateOwnComment(target: PullRequestCommentTarget, commentId: string, body: string): Promise<void> {
  const data = await graphql(target, updateComment, { id: commentId, body });
  if (record(record(data.updatePullRequestReviewComment)?.pullRequestReviewComment)?.id !== commentId) {
    throw new Error("GitHub did not confirm the Agent review comment update.");
  }
}

async function resolveOwnThread(target: PullRequestCommentTarget, threadId: string): Promise<void> {
  const data = await graphql(target, resolveThread, { id: threadId });
  if (record(record(data.resolveReviewThread)?.thread)?.id !== threadId) {
    throw new Error("GitHub did not confirm the Agent review thread resolution.");
  }
}

/** Reconcile only comments authored by the authenticated GitHub bot. Leave every other thread intact. */
export async function publishAgentReview(
  target: PullRequestCommentTarget,
  draft: ReviewDraft,
  verifyPublisher?: () => Promise<void>,
): Promise<void> {
  const { threads, requestedChanges } = await existingReviews(target, draft);
  const original = new Map(threads.filter(({ key }) => key).map((thread) => [thread.key, thread]));
  const current = async (): Promise<void> => {
    if (verifyPublisher) await verifyPublisher();
    requireCurrent(await graphql(target, currentQuery, requestVariables(target)), draft);
  };
  const retained = new Set<string>();
  const missing: SuggestionComment[] = [];
  for (const comment of draft.comments) {
    const key = anchorKey(comment.path, comment.body, comment.line, comment.start_line);
    if (!key) throw new Error("Agent review comment is missing its ownership marker.");
    const existing = original.get(key);
    if (!existing) {
      missing.push(comment);
      continue;
    }
    retained.add(existing.id);
    if (existing.body === comment.body) continue;
    if (!existing.canUpdate) throw new Error("GitHub did not authorize the bot to update its Agent review.");
    await current();
    await updateOwnComment(target, existing.commentId, comment.body);
  }
  if (missing.length > 0 || (draft.comments.length > 0 && draft.event === "REQUEST_CHANGES" && !requestedChanges)) {
    await current();
    await githubRequest(
      target,
      "POST",
      `/repos/${target.repository}/pulls/${target.pullRequest}/reviews`,
      {
        commit_id: draft.head,
        event: draft.event,
        body: `${reviewMarker}\nOffing lifecycle review`,
        comments: missing,
      },
      timeout(),
    );
  }
  for (const thread of threads) {
    if (!thread.canResolve || retained.has(thread.id)) continue;
    await current();
    await resolveOwnThread(target, thread.id);
  }
}
