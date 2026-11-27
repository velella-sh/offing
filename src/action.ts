#!/usr/bin/env node

import { appendFile, readFile, stat } from "node:fs/promises";
import process from "node:process";
import { dirname, relative, resolve } from "node:path";

import {
  readAgentReviewEvent,
  reportAgentReview,
  reviewFindingKey,
  type AgentReviewReport,
  type PostedReviewFindings,
} from "./action-agent-review.js";
import { publishActionFixes } from "./action-fix-pr.js";
import { runCommentCommands } from "./action-commands.js";
import {
  highestSeverity,
  nextEndOfLife,
  parsePathsInput,
  parseSbomInput,
  PR_COMMENT_MARKER,
  renderFindingsJson,
  renderComment,
  renderFailure,
  renderSummary,
  renderSuggestionReview,
  resolveScanPaths,
  runGitHubAction,
  suggestionComment,
} from "./github-action.js";
import { readReleaseGateDays, releaseGateSummary } from "./github-action/release-gate.js";
import { parseFleetPolicyInput } from "./github-action/inputs.js";
import { prepareForecast, readForecastMonths } from "./github-action/forecast.js";
import { compactPullRequestComment, limitPullRequestComment } from "./github-action/render.js";
import { preparePullRequestCountdown } from "./github-action/pr-context.js";
import type { PullRequestCountdown } from "./github-action/pr-countdown.js";
import { trackingIssueEventAllowed, upsertTrackingIssue } from "./action-tracking-issue.js";
import { upsertFixSuggestionsReview, upsertPullRequestComment } from "./pr-comment.js";
import type { GitHubActionOutcome, GitHubAnnotation, SeverityGate, UnannotatedFindings } from "./github-action.js";
import { createBaseline, daysBetween } from "./baseline.js";
import type { Baseline, ExpiredPolicy } from "./baseline.js";

/** The branch the onboarding app opens its pull request from. */
const ONBOARDING_BRANCH = "offing/onboarding";

function onOnboardingBranch(env: Record<string, string | undefined>): boolean {
  return (
    env.GITHUB_HEAD_REF === ONBOARDING_BRANCH ||
    env.GITHUB_REF_NAME === ONBOARDING_BRANCH ||
    env.GITHUB_REF === `refs/heads/${ONBOARDING_BRANCH}`
  );
}

interface OnboardingEvent {
  pull_request?: { head?: { repo?: { full_name?: string } } };
}

/**
 * True for the onboarding pull request this repository opens itself. A fork that names its branch
 * `offing/onboarding` is an ordinary pull request and must still meet the severity gate.
 */
async function isOnboardingRun(env: Record<string, string | undefined>): Promise<boolean> {
  if (!onOnboardingBranch(env)) return false;
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) return true;
  let event: OnboardingEvent;
  try {
    event = JSON.parse(await readFile(eventPath, "utf8")) as OnboardingEvent;
  } catch {
    return false;
  }
  const headRepository = event.pull_request?.head?.repo?.full_name;
  return headRepository === undefined || headRepository === env.GITHUB_REPOSITORY;
}

/** The generated baseline as a suggested file the onboarding pull request can add. */
function renderBaselineProposal(path: string, baseline: Baseline): string {
  const count = baseline.findings.length;
  return [
    `### Suggested file: \`${path}\``,
    "",
    `\`${path}\` does not exist yet, so this first run on \`${ONBOARDING_BRANCH}\` recorded today's ${count} finding${count === 1 ? "" : "s"} in this baseline. Add the file to this branch; later runs suppress these findings and report only new ones. Offing never writes to your repository.`,
    "",
    "```json",
    JSON.stringify(baseline, null, 2),
    "```",
    "",
  ].join("\n");
}

function commandValue(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function commandProperty(value: string): string {
  return commandValue(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function annotationCommand(annotation: GitHubAnnotation): string {
  const properties = [
    `file=${commandProperty(annotation.location.path)}`,
    annotation.location.line ? `line=${annotation.location.line}` : undefined,
    annotation.location.column ? `col=${annotation.location.column}` : undefined,
    `title=${commandProperty(annotation.title)}`,
  ].filter((value): value is string => value !== undefined);
  return `::${annotation.level} ${properties.join(",")}::${commandValue(annotation.message)}`;
}

async function setOutput(name: string, value: string): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (output) await appendFile(output, `${name}=${value}\n`, "utf8");
}

async function writeSummary(body: string): Promise<void> {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, body, "utf8");
}

/** The run page lists the uploaded report artifact, so it is the link the summary uses for the full report. */
function reportUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return process.env["INPUT_UPLOAD-REPORT"] === "true" && server && repository && runId
    ? `${server}/${repository}/actions/runs/${runId}`
    : undefined;
}

interface RepositoryRef {
  full_name?: string;
  fork?: boolean;
}

interface PullRequestEvent {
  repository?: { default_branch?: string; fork?: boolean };
  pull_request?: {
    number?: number;
    user?: { login?: string };
    base?: { sha?: string; repo?: RepositoryRef };
    head?: { sha?: string; ref?: string; repo?: RepositoryRef };
  };
}

async function readEvent(eventPath?: string): Promise<PullRequestEvent> {
  return eventPath ? (JSON.parse(await readFile(eventPath, "utf8")) as PullRequestEvent) : {};
}

/** Reads the event payload's pull request base and head. Falls back to a scan when they are absent. */
function resolveDiffMode(event: PullRequestEvent): { mode?: "diff"; diffRange?: string } | undefined {
  const base = event.pull_request?.base?.sha;
  const head = event.pull_request?.head?.sha;
  if (!base || !head) {
    console.log(
      "::notice title=Offing diff mode skipped::mode: diff needs a pull_request event with base and head SHAs; scanning the checkout instead.",
    );
    return undefined;
  }
  return { mode: "diff", diffRange: `${base}..${head}` };
}

/** A pull request from a fork runs with a read-only token, so no review can be written. */
function isForkPullRequest(event: PullRequestEvent): boolean {
  const head = event.pull_request?.head?.repo;
  const base = event.pull_request?.base?.repo;
  if (head?.full_name !== undefined && base?.full_name !== undefined) return head.full_name !== base.full_name;
  return head?.fork === true;
}

function policyFailureNote(outcome: GitHubActionOutcome): string {
  const rules = [...new Set(outcome.result.policy?.violations.map(({ rule }) => rule))];
  const expired = outcome.expiredFailure
    ? "\n> **Failed:** a baseline suppression has expired and `on-expired` is set to `fail`.\n"
    : "";
  const policy =
    rules.length > 0 ? `\n> **Failed lifecycle policy:** ${rules.map((rule) => `\`${rule}\``).join(", ")}.\n` : "";
  return expired + policy;
}

function scanCommentBody(
  outcome: GitHubActionOutcome,
  unannotated: UnannotatedFindings | undefined,
  proposal: ProposedBaseline | undefined,
  forecast: string | undefined,
  countdown: PullRequestCountdown | undefined,
  posted?: PostedReviewFindings,
): string {
  const { result, gateFailed, gate, diff, packages, agent } = outcome;
  const attribution = process.env.INPUT_ATTRIBUTION !== "false";
  const findings = posted
    ? result.findings.filter((finding) => !posted.local.has(reviewFindingKey(finding)))
    : result.findings;
  const reviewed = result.findings.length - findings.length;
  const commentAgent =
    posted && agent
      ? { ...agent, findings: agent.findings.filter((finding) => !posted.local.has(reviewFindingKey(finding))) }
      : agent;
  const commentCountdown = posted && countdown ? remainingCountdown(countdown, posted.repository) : countdown;
  const body = renderComment(
    findings,
    gateFailed,
    gate,
    result.data,
    attribution,
    result.suppressions,
    diff,
    packages,
    unannotated,
    commentAgent,
    commentCountdown,
    reviewed,
  );
  const proposalNote = proposal ? `\n${renderBaselineProposal(proposal.path, proposal.baseline)}` : "";
  const forecastNote = forecast ? `\n${forecast}` : "";
  const full = `${body}${policyFailureNote(outcome)}${proposalNote}${forecastNote}`;
  return limitPullRequestComment(full, () =>
    compactPullRequestComment(findings, gateFailed, gate, attribution, commentCountdown, reviewed),
  );
}

function remainingCountdown(countdown: PullRequestCountdown, posted: ReadonlySet<string>): PullRequestCountdown {
  const findings = countdown.findings.filter((finding) => !posted.has(reviewFindingKey(finding)));
  return {
    ...countdown,
    findings,
    timelineFindings: countdown.timelineFindings.filter((finding) => !posted.has(reviewFindingKey(finding))),
    reviewedDated: findings.length !== countdown.findings.length,
  };
}

function stepSummaryBody(
  outcome: GitHubActionOutcome,
  unannotated: UnannotatedFindings | undefined,
  proposal: ProposedBaseline | undefined,
  forecast: string | undefined,
): string {
  const { result, gateFailed, gate, diff, packages, agent } = outcome;
  const attribution = process.env.INPUT_ATTRIBUTION !== "false";
  const summary = renderSummary(
    result.findings,
    gateFailed,
    gate,
    result.data,
    attribution,
    result.suppressions,
    diff,
    packages,
    unannotated,
    agent,
  );
  const count = proposal?.baseline.findings.length ?? 0;
  const proposalNote = proposal
    ? `\n> **Suggested baseline:** \`${proposal.path}\` does not exist yet, so this first run recorded its ${count} finding${plural(count)} in a baseline proposal on the pull request comment.\n`
    : "";
  return `${summary}${policyFailureNote(outcome)}${releaseGateSummary(outcome.releaseGate)}${proposalNote}${forecast ? `\n${forecast}` : ""}`;
}

/** Posts or updates the one summary comment. A comment that cannot be posted warns without failing the scan. */
async function postComment(body: string, ctx: RunContext, forecastOnly = false): Promise<void> {
  if (ctx.fork) {
    const title = forecastOnly ? "forecast comment" : "pull request comment";
    console.log(
      `::notice title=Offing ${title} skipped::This fork pull request uses a read-only token. See the job summary.`,
    );
    return;
  }
  try {
    const pullRequest = ctx.event.pull_request?.number;
    const token = ctx.env["INPUT_GITHUB-TOKEN"];
    const repository = ctx.env.GITHUB_REPOSITORY;
    if (!pullRequest || !token || !repository) {
      console.log(
        "::notice title=Offing pull request comment skipped::pr-comment needs a pull_request event, a token, and GITHUB_REPOSITORY.",
      );
      return;
    }
    const done = await upsertPullRequestComment(
      { apiUrl: ctx.env.GITHUB_API_URL ?? "https://api.github.com", repository, pullRequest, token },
      body,
    );
    console.log(`Offing ${done} its pull request comment.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::warning title=Offing could not post the pull request comment::${commandValue(message)}`);
  }
}

async function readCountdown(outcome: GitHubActionOutcome, ctx: RunContext): Promise<PullRequestCountdown | undefined> {
  const pr = ctx.event.pull_request;
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = ctx.env;
  const receipt = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}#artifacts` : undefined;
  try {
    const { countdown, receiptPath } = await preparePullRequestCountdown(
      outcome,
      { base: pr?.base?.sha, head: pr?.head?.sha },
      receipt,
    );
    if (receiptPath) await setOutput("receipt-path", receiptPath);
    return countdown;
  } catch {
    console.log(
      "::notice title=Offing PR countdown skipped::Check out the pull request head or merge commit with fetch-depth: 0.",
    );
    return undefined;
  }
}

async function publishScanSummaries(
  outcome: GitHubActionOutcome,
  ctx: RunContext,
  proposal: ProposedBaseline | undefined,
  forecast: string | undefined,
  posted?: PostedReviewFindings,
): Promise<void> {
  const unannotated = unannotatedNote(outcome);
  const pr = ctx.event.pull_request;
  if (ctx.env["INPUT_PR-COMMENT"] === "true" && pr) {
    const countdown = await readCountdown(outcome, ctx);
    const body = scanCommentBody(outcome, unannotated, proposal, forecast, countdown);
    await writeSummary(body);
    await postComment(
      posted ? scanCommentBody(outcome, unannotated, proposal, forecast, countdown, posted) : body,
      ctx,
    );
    return;
  }
  await writeSummary(stepSummaryBody(outcome, unannotated, proposal, forecast));
  if (proposal) await postComment(scanCommentBody(outcome, unannotated, proposal, forecast, undefined), ctx);
  else if (pr && forecast) await postComment(`${PR_COMMENT_MARKER}\n\n${forecast}`, ctx, true);
}

/**
 * Updates the one lifecycle tracking issue after the scan. Like the pull request comment, a failure
 * warns and never changes the scan result.
 */
async function updateTrackingIssue(outcome: Awaited<ReturnType<typeof runGitHubAction>>): Promise<void> {
  if (process.env["INPUT_TRACKING-ISSUE"] !== "true") return;
  if (!trackingIssueEventAllowed(process.env.GITHUB_EVENT_NAME)) {
    console.log(
      "::notice title=Offing tracking issue skipped::tracking-issue updates one issue on schedule and workflow_dispatch runs; pull request tokens are read-only.",
    );
    return;
  }
  try {
    const token = process.env["INPUT_GITHUB-TOKEN"];
    const repository = process.env.GITHUB_REPOSITORY;
    if (!token || !repository) {
      console.log("::notice title=Offing tracking issue skipped::tracking-issue needs a token and GITHUB_REPOSITORY.");
      return;
    }
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const prefix = relative(workspace, outcome.result.root).replaceAll("\\", "/");
    const done = await upsertTrackingIssue(
      {
        apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
        repository,
        token,
        serverUrl: process.env.GITHUB_SERVER_URL ?? "https://github.com",
        ...(process.env.GITHUB_SHA ? { ref: process.env.GITHUB_SHA } : {}),
        ...(prefix && !prefix.startsWith("..") ? { pathPrefix: prefix } : {}),
      },
      outcome.result.findings,
      outcome.result.scannedAt.slice(0, 10),
    );
    if (done === "none") console.log("Offing has no tracking issue to change.");
    else if (done === "too-large")
      console.log(
        "::warning title=Offing tracking issue is too large::the issue body would exceed GitHub's 65,536-character limit even after shortening the findings table, so the tracking issue was not updated.",
      );
    else console.log(`Offing ${done} its lifecycle tracking issue.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::warning title=Offing could not update the tracking issue::${commandValue(message)}`);
  }
}

/** Posts or updates the one review of deterministic fix suggestions. A failure warns; it never fails the scan. */
async function postFixSuggestions(
  outcome: Awaited<ReturnType<typeof runGitHubAction>>,
  event: PullRequestEvent,
): Promise<void> {
  if (process.env["INPUT_SUGGEST-FIXES"] !== "true" || outcome.suggestions.length === 0) return;
  // A fork's token is read-only and the runner already said so; there is nothing to post.
  if (isForkPullRequest(event)) return;
  try {
    const pullRequest = event.pull_request?.number;
    const token = process.env["INPUT_GITHUB-TOKEN"];
    const repository = process.env.GITHUB_REPOSITORY;
    if (!pullRequest || !token || !repository) {
      console.log(
        "::notice title=Offing fix suggestions skipped::suggest-fixes needs a pull_request event, a token, and GITHUB_REPOSITORY.",
      );
      return;
    }
    const headSha = event.pull_request?.head?.sha;
    const done = await upsertFixSuggestionsReview(
      { apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com", repository, pullRequest, token },
      {
        body: renderSuggestionReview(outcome.suggestions.length),
        ...(headSha === undefined ? {} : { commitId: headSha }),
        comments: outcome.suggestions.map(suggestionComment),
      },
    );
    console.log(`Offing ${done} its fix suggestions review.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::warning title=Offing could not post the fix suggestions review::${commandValue(message)}`);
  }
}

type Env = Record<string, string | undefined>;
type RunOptions = Parameters<typeof runGitHubAction>[0];
type RunOutcome = Awaited<ReturnType<typeof runGitHubAction>>;
type AnnotationMode = "changed" | "all" | "none";
type ProposedBaseline = { path: string; baseline: Baseline };
type DiffScope = { mode?: "diff"; diffRange?: string };

/** Everything the run decided up front, passed to the helpers that build its options. */
interface RunContext {
  env: Env;
  workspace: string;
  root: string;
  scanPaths: string[] | undefined;
  sbom: string | undefined;
  event: PullRequestEvent;
  diff: DiffScope | undefined;
  fork: boolean;
  suggestFixes: boolean;
  inputAnnotations: AnnotationMode | undefined;
  proposeBaseline: boolean;
  reportPaths: ReportPaths;
}

interface ReportPaths {
  reportPath: string;
  sarifPath: string | undefined;
  badgePath: string | undefined;
}

function isAnnotationMode(value: string): value is AnnotationMode {
  return value === "changed" || value === "all" || value === "none";
}

const plural = (count: number): string => (count === 1 ? "" : "s");

/** A `/offing` comment is answered instead of scanned. True when that was this run. */
async function answerCommentRun(env: Env, root: string): Promise<boolean> {
  if (env.INPUT_COMMANDS !== "true" || env.GITHUB_EVENT_NAME !== "issue_comment") return false;
  await runCommentCommands({
    root,
    ...(env.GITHUB_EVENT_PATH ? { eventPath: env.GITHUB_EVENT_PATH } : {}),
    ...(env.INPUT_BASELINE ? { baselinePath: env.INPUT_BASELINE } : {}),
    ...(env["INPUT_GITHUB-TOKEN"] ? { token: env["INPUT_GITHUB-TOKEN"] } : {}),
    ...(env.GITHUB_REPOSITORY ? { repository: env.GITHUB_REPOSITORY } : {}),
    ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}),
  });
  return true;
}

/** The mode and annotation inputs, checked before anything runs. */
function readModeInputs(env: Env): { inputMode: "scan" | "diff"; inputAnnotations: AnnotationMode | undefined } {
  const inputMode = env.INPUT_MODE || "scan";
  if (inputMode !== "scan" && inputMode !== "diff")
    throw new Error(`Invalid mode: ${inputMode}. Use "scan" or "diff".`);
  const inputAnnotations = env.INPUT_ANNOTATIONS || undefined;
  if (inputAnnotations !== undefined && !isAnnotationMode(inputAnnotations)) {
    throw new Error(`Invalid annotations: ${inputAnnotations}. Use "changed", "all", or "none".`);
  }
  return { inputMode, inputAnnotations };
}

/** Where the run's report and optional SARIF and badge files go. */
function resolveReportPaths(env: Env, workspace: string): ReportPaths {
  const runnerTemp = env.RUNNER_TEMP ?? workspace;
  return {
    reportPath: resolve(runnerTemp, "offing-report.json"),
    sarifPath:
      env.INPUT_SARIF === "true" || env["INPUT_UPLOAD-SARIF"] === "true"
        ? resolve(runnerTemp, "offing-results.sarif")
        : undefined,
    badgePath: env["INPUT_UPLOAD-BADGE"] === "true" ? resolve(runnerTemp, "offing-badge.json") : undefined,
  };
}

/** The inputs this mode ignores, announced in the run log so a setting never has a silent effect. */
function noticeIgnoredInputs(facts: {
  inputMode: "scan" | "diff";
  pathPatterns: readonly string[];
  suggestFixes: boolean;
  diff: DiffScope | undefined;
  fork: boolean;
  inputAnnotations: AnnotationMode | undefined;
  baseline: string | undefined;
}): void {
  const { diff } = facts;
  if (facts.pathPatterns.length > 0 && facts.inputMode === "diff") {
    console.log(
      "::notice title=Offing paths ignored in diff mode::mode: diff compares the whole pull request checkout; the paths input applies only to scan mode.",
    );
  }
  if (facts.suggestFixes && !diff)
    console.log(
      "::notice title=Offing suggest-fixes skipped::suggest-fixes needs mode: diff and a pull_request event, because suggestions apply only to lines the pull request changed.",
    );
  if (facts.suggestFixes && diff && facts.fork)
    console.log(
      "::notice title=Offing suggest-fixes skipped::Pull requests from forks get a read-only token, so Offing cannot post a review with fix suggestions.",
    );
  if (diff && facts.baseline)
    console.log(
      `::notice title=Offing baseline ignored in diff mode::mode: diff judges only what the pull request introduces, so the baseline ${facts.baseline} is not applied.`,
    );
  if (facts.inputAnnotations === "changed" && !diff)
    console.log(
      "::notice title=Offing annotations: changed needs diff mode::annotations: changed annotates only lines a pull request changed, and this run has no pull request range; annotating every finding.",
    );
}

/**
 * The onboarding pull request starts without a baseline, so its first run records today's findings as a
 * suggested file instead of failing on them. Returns that path, or undefined when this run proposes nothing.
 * Offing never writes the file or pushes it.
 */
async function baselineProposalPath(
  env: Env,
  workspace: string,
  root: string,
  diff: DiffScope | undefined,
): Promise<string | undefined> {
  const path = (diff ? undefined : env.INPUT_BASELINE) || undefined;
  if (path === undefined || !(await isOnboardingRun(env))) return undefined;
  const existing = await stat(resolve(workspace, root, path)).catch(() => undefined);
  return existing === undefined ? path : undefined;
}

/** What is scanned, where the results go, and what they are compared against. */
function scanOptionsFor(ctx: RunContext): Partial<RunOptions> {
  const { env, diff, scanPaths, reportPaths } = ctx;
  const branch = sameRepositoryPullRequestBranch(ctx.event);
  return {
    ...(scanPaths ? { paths: scanPaths } : {}),
    ...(ctx.sbom ? { sbom: ctx.sbom } : {}),
    ...(reportPaths.sarifPath ? { sarifPath: reportPaths.sarifPath } : {}),
    ...(reportPaths.badgePath ? { badgePath: reportPaths.badgePath } : {}),
    ...(diff ? { mode: "diff" as const } : {}),
    ...(diff?.diffRange ? { diffRange: diff.diffRange } : {}),
    ...(ctx.event.pull_request?.user?.login ? { pullRequestAuthor: ctx.event.pull_request.user.login } : {}),
    ...(branch ? { pullRequestSameRepositoryBranch: branch } : {}),
    ...(env["INPUT_AGENT-AUTHORS"] !== undefined ? { agentAuthors: env["INPUT_AGENT-AUTHORS"] } : {}),
    ...(env.INPUT_BASELINE && !ctx.proposeBaseline ? { baselinePath: env.INPUT_BASELINE } : {}),
  };
}

function sameRepositoryPullRequestBranch(event: PullRequestEvent): string | undefined {
  const head = event.pull_request?.head;
  const base = event.pull_request?.base?.repo?.full_name;
  return base !== undefined && head?.repo?.full_name === base ? head.ref : undefined;
}

/** The severity gate, the expiry policy, and how findings are annotated. */
function policyOptionsFor(ctx: RunContext): Pick<RunOptions, "failOnSeverity"> & Partial<RunOptions> {
  const { env } = ctx;
  const policy = parseFleetPolicyInput(env.INPUT_POLICY);
  const releaseGateDays = readReleaseGateDays(env["INPUT_RELEASE-GATE-DAYS"]);
  return {
    ...(policy ? { policy } : {}),
    ...(releaseGateDays === undefined ? {} : { releaseGateDays }),
    ...(env["INPUT_BASELINE-WARN-DAYS"] ? { baselineWarnDays: Number(env["INPUT_BASELINE-WARN-DAYS"]) } : {}),
    ...(env["INPUT_ON-EXPIRED"] ? { onExpired: env["INPUT_ON-EXPIRED"] as ExpiredPolicy } : {}),
    ...(env["INPUT_MIN-SUPPORT-DAYS"] ? { minSupportDays: Number(env["INPUT_MIN-SUPPORT-DAYS"]) } : {}),
    ...(ctx.inputAnnotations ? { annotations: ctx.inputAnnotations } : {}),
    ...(ctx.suggestFixes && ctx.diff && !ctx.fork ? { suggestFixes: true } : {}),
    failOnSeverity: (ctx.proposeBaseline ? "none" : env["INPUT_FAIL-ON-SEVERITY"] || "high") as SeverityGate,
  };
}

/** The first-line warnings for baseline suppressions that have expired or are about to. */
function warnAboutSuppressions(outcome: RunOutcome): void {
  for (const diagnostic of outcome.result.diagnostics) {
    if (diagnostic.includes("Baseline suppression expired"))
      console.log(`::warning title=Offing baseline suppression expired::${commandValue(diagnostic)}`);
    if (diagnostic.includes("Baseline suppression expires"))
      console.log(`::warning title=Offing baseline suppression expires soon::${commandValue(diagnostic)}`);
  }
}

async function publishOutputs(outcome: RunOutcome): Promise<void> {
  const { findings } = outcome.result;
  await setOutput("report-path", outcome.reportPath);
  if (outcome.sarifPath) await setOutput("sarif-path", outcome.sarifPath);
  if (outcome.badgePath) await setOutput("badge-path", outcome.badgePath);
  if (outcome.badgeSvgPath) await setOutput("badge-svg-path", outcome.badgeSvgPath);
  await setOutput("finding-count", String(findings.length));
  await setOutput("has-new-findings", findings.length > 0 ? "true" : "false");
  await setOutput("highest-severity", highestSeverity(findings));
  const deadline = nextEndOfLife(findings);
  await setOutput("next-eol-date", deadline);
  await setOutput(
    "next-eol-days",
    deadline ? String(daysBetween(outcome.result.scannedAt.slice(0, 10), deadline)) : "",
  );
  await setOutput("findings-json", renderFindingsJson(findings));
}

/** The count of findings no annotation could point at, with a link to the full report when there is one. */
function unannotatedNote(outcome: RunOutcome): { count: number; reportUrl?: string } | undefined {
  if (outcome.unannotated === 0) return undefined;
  const link = reportUrl();
  return { count: outcome.unannotated, ...(link ? { reportUrl: link } : {}) };
}

/** The one line the run log ends with: what this run found, in the mode it ran in. */
function runSummary(
  outcome: RunOutcome,
  diff: DiffScope | undefined,
  scanCount: number | undefined,
  proposal: ProposedBaseline | undefined,
): string {
  const count = outcome.result.findings.length;
  if (proposal) {
    const proposed = proposal.baseline.findings.length;
    return `Offing proposed a baseline of ${proposed} finding${plural(proposed)} for ${proposal.path} in the pull request comment.`;
  }
  if (diff) {
    const fixed = outcome.diff?.fixed.length ?? 0;
    return `Offing found ${count} introduced lifecycle finding${plural(count)} and ${fixed} fixed lifecycle finding${plural(fixed)} between ${diff.diffRange}.`;
  }
  if (scanCount !== undefined)
    return `Offing found ${count} new lifecycle finding${plural(count)} across ${scanCount} package${plural(scanCount)}.`;
  return `Offing found ${count} new lifecycle finding${plural(count)}.`;
}

/** The baseline this run would have written, offered in the pull request comment instead of enforced. */
function proposedBaselineFor(outcome: RunOutcome, path: string): ProposedBaseline {
  return {
    path,
    baseline: createBaseline(outcome.result, {}, { schemaVersion: "offing.baseline.v1", createdAt: "", findings: [] }),
  };
}

function warnAboutStaleData(outcome: RunOutcome): void {
  const data = outcome.result.data;
  if (data?.stale)
    console.log(
      `::warning title=Offing lifecycle data is stale::The data is ${data.ageDays} days old, so findings may miss recent changes.`,
    );
}

/** Fails the run, with the reason, when the policy gate says so. */
function reportGateFailure(outcome: RunOutcome): void {
  const failure = renderFailure(outcome);
  if (!failure) return;
  console.log(`::error title=Offing policy gate failed::${commandValue(failure)}`);
  process.exitCode = 1;
}

interface PreparedRun {
  ctx: RunContext;
  proposeBaselinePath: string | undefined;
}

/** Reads the workflow inputs and event into the context one run works from. */
async function prepareRun(env: Env, root: string, workspace: string): Promise<PreparedRun> {
  const { inputMode, inputAnnotations } = readModeInputs(env);
  const pathPatterns = parsePathsInput(env.INPUT_PATHS ?? "");
  if (env["INPUT_RELEASE-GATE-DAYS"]?.trim() && (inputMode === "diff" || pathPatterns.length > 0)) {
    throw new Error("release-gate-days requires one root or SBOM in scan mode.");
  }
  const sbom = parseSbomInput(env.INPUT_SBOM, inputMode, pathPatterns);
  const event = await readEvent(env.GITHUB_EVENT_PATH);
  const diff = inputMode === "diff" ? resolveDiffMode(event) : undefined;
  const suggestFixes = env["INPUT_SUGGEST-FIXES"] === "true";
  const fork = isForkPullRequest(event);
  noticeIgnoredInputs({
    inputMode,
    pathPatterns,
    suggestFixes,
    diff,
    fork,
    inputAnnotations,
    baseline: env.INPUT_BASELINE,
  });
  const scanPaths =
    pathPatterns.length > 0 && inputMode !== "diff"
      ? await resolveScanPaths(resolve(workspace, root), pathPatterns)
      : undefined;

  const proposeBaselinePath = await baselineProposalPath(env, workspace, root, diff);
  if (proposeBaselinePath !== undefined) {
    console.log(
      `::notice title=Offing proposed a baseline::${proposeBaselinePath} does not exist yet, so this first run on ${ONBOARDING_BRANCH} proposes it in the pull request comment and does not enforce the severity gate.`,
    );
  }
  const ctx: RunContext = {
    env,
    workspace,
    root,
    scanPaths,
    sbom,
    event,
    diff,
    fork,
    suggestFixes,
    inputAnnotations,
    proposeBaseline: proposeBaselinePath !== undefined,
    reportPaths: resolveReportPaths(env, workspace),
  };
  return { ctx, proposeBaselinePath };
}

/** Publishes everything one finished run reports, then fails the step when the gate failed. */
async function reportOutcome(
  review: AgentReviewReport,
  ctx: RunContext,
  proposeBaselinePath: string | undefined,
  forecastMonths: number | undefined,
): Promise<void> {
  const { outcome, posted, packetDirectory } = review;
  const proposal = proposeBaselinePath === undefined ? undefined : proposedBaselineFor(outcome, proposeBaselinePath);
  for (const annotation of outcome.annotations) console.log(annotationCommand(annotation));
  warnAboutSuppressions(outcome);
  await publishOutputs(outcome);
  if (packetDirectory) await setOutput("agent-packet-path", packetDirectory);
  const forecast = await publishForecast(outcome, ctx, forecastMonths);
  await publishScanSummaries(outcome, ctx, proposal, forecast, posted);
  if (!posted) await postFixSuggestions(outcome, ctx.event);
  await publishActionFixes(outcome.result, ctx.env, ctx.event.repository, ctx.fork, {
    setOutput,
    writeSummary,
    commandValue,
  });
  await updateTrackingIssue(outcome);
  warnAboutStaleData(outcome);
  console.log(runSummary(outcome, ctx.diff, ctx.scanPaths?.length, proposal));
  reportGateFailure(outcome);
}

async function publishForecast(outcome: RunOutcome, ctx: RunContext, months?: number): Promise<string | undefined> {
  if (months === undefined) return undefined;
  const pr = ctx.event.pull_request;
  const forecast = await prepareForecast(
    resolve(ctx.workspace, ctx.root),
    dirname(outcome.reportPath),
    outcome.result.scannedAt.slice(0, 10),
    months,
    pr ? { base: pr.base?.sha, head: pr.head?.sha } : undefined,
  );
  if (forecast?.calendarPath) await setOutput("forecast-calendar-path", forecast.calendarPath);
  return forecast?.summary;
}

async function main(): Promise<void> {
  try {
    const env: Env = process.env;
    const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
    const root = env.INPUT_PATH || workspace;
    if (await answerCommentRun(env, root)) return;

    const reviewEvent = readAgentReviewEvent(env);
    const months = env.INPUT_FORECAST === "true" ? readForecastMonths(env["INPUT_FORECAST-MONTHS"]) : undefined;
    const { ctx, proposeBaselinePath } = await prepareRun(env, root, workspace);
    const outcome = await runGitHubAction({
      root: ctx.scanPaths ? resolve(workspace, root) : root,
      reportPath: ctx.reportPaths.reportPath,
      ...scanOptionsFor(ctx),
      ...policyOptionsFor(ctx),
    });
    const reviewed = await reportAgentReview(outcome, env, ctx.event.pull_request, reviewEvent);
    await reportOutcome(reviewed, ctx, proposeBaselinePath, months);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error title=Offing failed::${commandValue(message)}`);
    process.exitCode = 1;
  }
}

void main();
