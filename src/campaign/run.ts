import { open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import * as z from "zod/v4";

import { readJsonFile } from "../agent-drivers/result.js";
import { runReplayLoop } from "../autopilot/replay.js";
import { startRun } from "../autopilot/state.js";
import { withAutopilotWorktree } from "../autopilot/worktree.js";
import { loadConfig } from "../config.js";
import { autopilotEvidence } from "../github-action/autopilot-evidence.js";
import { repositoryKey } from "../fleet-forecast/model.js";
import { checkedAutopilotRun, checkedVerifyResult } from "../proof/document.js";
import {
  type CampaignRepository,
  type CampaignState,
  type RepositoryStatus,
  invalidCampaign,
  readCampaignState,
} from "./document.js";
import { campaignTokenNames } from "./host-config.js";
import { saveCampaignProof } from "./proof.js";

type Save = () => Promise<void>;
type Clock = () => number;

async function lockState(path: string) {
  const handle = await open(path, "wx", 0o600).catch(() => {
    throw invalidCampaign("Cannot lock campaign state. Another command may be writing it.");
  });
  try {
    await handle.writeFile(String(process.pid));
    return handle;
  } catch (error) {
    await handle.close();
    await rm(path, { force: true });
    throw error;
  }
}

async function saveState(file: string, content: string) {
  const pending = file + ".pending";
  await rm(pending, { force: true });
  await writeFile(pending, content, { flag: "wx", mode: 0o600, flush: true });
  await rename(pending, file);
}

/** Operations acquire the same lock, including control commands, and serialize every committed snapshot. */
export async function updateCampaign<T>(file: string, use: (state: CampaignState, save: Save) => Promise<T>) {
  const path = await realpath(file);
  const lock = path + ".lock";
  const handle = await lockState(lock);
  try {
    const state = await readCampaignState(path);
    let pending = Promise.resolve();
    return await use(state, () => {
      const content = JSON.stringify(state, null, 2) + "\n";
      pending = pending.then(() => saveState(path, content));
      return pending;
    });
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

const input = z.strictObject({
  host: z.string().min(1),
  name: z.string().min(1),
  checkout: z.string().min(1),
  recording: z.string().min(1),
  finding: z.string().min(1).max(1024),
});

type LocalInput = Pick<z.infer<typeof input>, "checkout" | "recording" | "finding">;

export async function readRunInputs(file: string): Promise<ReadonlyMap<string, LocalInput>> {
  const parsed = z.array(input).safeParse(await readJsonFile(file, 1024 * 1024).catch(() => undefined));
  if (!parsed.success)
    throw invalidCampaign("Expected a JSON array of campaign host, name, checkout, finding and recording inputs.");
  const inputs = new Map<string, LocalInput>();
  const folder = dirname(resolve(file));
  for (const row of parsed.data) {
    const key = repositoryKey(row.host, row.name);
    if (inputs.has(key)) throw invalidCampaign("Campaign execution inputs repeat a repository.");
    inputs.set(key, {
      checkout: resolve(folder, row.checkout),
      recording: resolve(folder, row.recording),
      finding: row.finding,
    });
  }
  return inputs;
}

export type CampaignResult = { status: "verified" } | { status: "failed"; reason: string };
type Checkpoint = (run: string) => Promise<void>;

export interface CampaignExecution {
  execute(repository: CampaignRepository, checkpoint: Checkpoint): Promise<CampaignResult>;
}

export interface LocalRunBackend {
  runTests?: Parameters<typeof runReplayLoop>[4];
  createReplay?: NonNullable<Parameters<typeof runReplayLoop>[3]["createReplay"]>;
}

function result(state: string, reason?: string): CampaignResult {
  if (state === "done") return { status: "verified" };
  return { status: "failed", reason: reason && /^[a-zA-Z0-9.-]{1,120}$/u.test(reason) ? reason : "autopilot-stopped" };
}

async function previousRun(repository: CampaignRepository, runId: string): Promise<CampaignResult> {
  const record = join(tmpdir(), `offing-autopilot-${runId}`, "autopilot-run.v1.json");
  const run = await readJsonFile(record, 1024 * 1024)
    .then(checkedAutopilotRun)
    .catch(() => undefined);
  if (run?.checkout?.id !== runId || run.checkout.baseCommit !== repository.commit) {
    return { status: "failed", reason: "missing-run-record" };
  }
  if (run.state !== "done") return result(run.state, run.stopReason);
  const evidence = resolve(dirname(record), "final-verify-result.json");
  const verification = await readJsonFile(evidence, 4 * 1024 * 1024)
    .then(checkedVerifyResult)
    .catch(() => undefined);
  if (
    run.replay?.tests !== "passed" ||
    verification?.verdict !== "passed" ||
    verification.before.commit !== repository.commit ||
    verification.after.commit !== run.replay.head
  ) {
    return { status: "failed", reason: "missing-verification" };
  }
  return { status: "verified" };
}

/** Execute only operator-mapped local checkouts and explicitly supplied replay recordings. */
export function localCampaign(
  state: CampaignState,
  inputs: ReadonlyMap<string, LocalInput>,
  backend: LocalRunBackend = {},
): CampaignExecution {
  const secretEnv = campaignTokenNames(process.env);
  const execute: CampaignExecution["execute"] = async (row, checkpoint) => {
    if (row.run) return previousRun(row, row.run);
    const matched = inputs.get(repositoryKey(row.host, row.name));
    if (!matched) return { status: "failed", reason: "missing-local-input" };
    const run = startRun("prepare");
    await withAutopilotWorktree(matched.checkout, run, async (tree, checkout) => {
      if (!run.checkout || run.checkout.baseCommit !== row.commit) {
        throw invalidCampaign("Campaign checkout does not match its pinned commit.");
      }
      const config = (await loadConfig(tree))?.autopilot;
      if (config?.driver !== "replay")
        throw invalidCampaign("Campaign local execution requires an approved replay driver.");
      const evidence = autopilotEvidence(process.env, secretEnv);
      await checkpoint(run.checkout.id);
      await runReplayLoop(
        tree,
        checkout,
        run,
        {
          selection: { finding: matched.finding, ...(state.target && { target: state.target }) },
          file: matched.recording,
          allowedBaseline: new Set(),
          started: performance.now(),
          secretEnv,
          capture: evidence.capture,
          configure: (config) => evidence.configure(config.secretEnv),
          ...(backend.createReplay && { createReplay: backend.createReplay }),
        },
        backend.runTests,
      );
      if (run.state === "done") {
        const artifact = await evidence.publish(tree, checkout.evidenceDirectory, run).catch(() => undefined);
        if (artifact) await saveCampaignProof(checkout.evidenceDirectory, row, artifact.files);
      }
    }).catch(() => undefined);
    if (run.state === "done" && row.run) return previousRun(row, row.run);
    return result(run.state, run.stopReason ?? "local-execution-refused");
  };
  return { execute };
}

export function transition(row: CampaignRepository, status: RepositoryStatus, clock: Clock): void {
  const previous = row.transitions.at(-1)?.at;
  const at = new Date(Math.max(clock(), previous ? Date.parse(previous) : 0)).toISOString();
  row.transitions.push({ from: row.status, to: status, at });
  row.status = status;
}

function active(row: CampaignRepository): boolean {
  return row.status === "queued" || row.status === "running";
}

async function runRow(row: CampaignRepository, execution: CampaignExecution, save: Save, clock: Clock) {
  if (row.status === "queued") {
    transition(row, "running", clock);
    await save();
  }
  const outcome = await execution.execute(row, async (run) => {
    row.run = run;
    await save();
  });
  if (outcome.status === "failed") row.reason = outcome.reason;
  transition(row, outcome.status, clock);
  await save();
}

async function runBatch(
  rows: CampaignRepository[],
  concurrency: number,
  work: (row: CampaignRepository) => Promise<void>,
) {
  const pending = rows.filter(active);
  for (let i = 0; i < pending.length; i += concurrency) {
    const operations = await Promise.allSettled(pending.slice(i, i + concurrency).map(work));
    const failure = operations.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
  }
}

export function gap(state: CampaignState, batch: number, now: number): string | undefined {
  const previous = state.repositories.filter((row) => row.batch < batch);
  let completedAt = 0;
  for (const row of previous) {
    const latest = row.transitions.at(-1);
    if (latest) completedAt = Math.max(completedAt, Date.parse(latest.at));
  }
  const next = completedAt + state.batching.minGapMinutes * 60_000;
  if (completedAt > 0 && next > now) return new Date(next).toISOString();
  return undefined;
}

async function evaluateBatch(state: CampaignState, number: number, rows: CampaignRepository[], save: Save) {
  const failed = rows.filter(({ status }) => status === "failed").length;
  state.checkedBatch = number;
  if (failed / rows.length > state.batching.maxFailureRate) {
    const reason = `Batch ${number} paused: ${failed}/${rows.length} failed (limit ${state.batching.maxFailureRate}).`;
    state.rollout = { state: "paused", reason };
    await save();
    return reason;
  }
  await save();
  return undefined;
}

async function recoverUncheckedBatches(state: CampaignState, nextBatch: number, save: Save) {
  for (let batch = (state.checkedBatch ?? 0) + 1; batch < nextBatch; batch += 1) {
    const rows = state.repositories.filter((row) => row.batch === batch);
    if (rows.length === 0) break;
    const reason = await evaluateBatch(state, batch, rows, save);
    if (reason) return reason;
  }
  return undefined;
}

export async function runCampaign(
  state: CampaignState,
  execution: CampaignExecution,
  save: Save,
  oneBatch: boolean,
  clock: Clock = Date.now,
): Promise<string> {
  if (state.rollout) return state.rollout.reason ?? `Campaign ${state.rollout.state}.`;
  for (;;) {
    const next = state.repositories.find(active);
    const upper = next?.batch ?? (state.repositories.at(-1)?.batch ?? 0) + 1;
    const unchecked = await recoverUncheckedBatches(state, upper, save);
    if (unchecked) return unchecked;
    if (!next) return "No pending campaign batches.";
    const due = gap(state, next.batch, clock());
    if (due) return `Batch ${next.batch} can start after ${due}.`;
    const rows = state.repositories.filter((row) => row.batch === next.batch);
    await runBatch(rows, state.batching.concurrency, (row) => runRow(row, execution, save, clock));
    const reason = await evaluateBatch(state, next.batch, rows, save);
    if (reason) return reason;
    if (oneBatch) return `Finished batch ${next.batch}.`;
  }
}

export function controlCampaign(
  state: CampaignState,
  action: "pause" | "resume" | "retry" | "cancel",
  repository?: string,
  clock: Clock = Date.now,
): void {
  if (state.rollout?.state === "cancelled") throw invalidCampaign("This campaign was cancelled.");
  if (action === "pause") state.rollout = { state: "paused" };
  if (action === "resume") delete state.rollout;
  if (action === "retry") retryCampaign(state, repository, clock);
  if (action === "cancel") {
    for (const row of state.repositories) {
      if (active(row) || (row.status === "verified" && !row.publication) || row.status === "failed") {
        transition(row, "cancelled", clock);
      }
    }
    state.rollout = { state: "cancelled" };
  }
}

function retryCampaign(state: CampaignState, repository: string | undefined, clock: Clock): void {
  const failed = state.repositories.filter(
    (row) =>
      row.status === "failed" &&
      (repository === undefined || row.name === repository || repositoryKey(row.host, row.name) === repository),
  );
  if (repository !== undefined && failed.length !== 1)
    throw invalidCampaign("Choose one failed repository by exact identity.");
  for (const row of failed) {
    transition(row, "queued", clock);
    if (state.checkedBatch !== undefined) state.checkedBatch = Math.min(state.checkedBatch, row.batch - 1);
    delete row.run;
    delete row.reason;
  }
}
