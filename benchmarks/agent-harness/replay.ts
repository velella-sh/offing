import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { createReplayDriver } from "../../src/agent-drivers/replay.js";
import { record, validPaths } from "../../src/agent-drivers/result.js";
import { materializeExample } from "../../tools/examples.js";
import type { StalenessTask } from "../agent-staleness/score.js";
import {
  type Arm,
  bundledScoringPin,
  readRecordedTarget,
  type ReplayPlan,
  type RunMeta,
  type ScoringPin,
} from "./contract.js";
import { replaySandboxTask, type TaskSandbox } from "./sandbox.js";
import { sessionPrompt } from "./session.js";

const maximumRecordingBytes = 8 * 1024 * 1024;

interface Attempt {
  task: StalenessTask;
  arm: Arm;
  attempt: number;
  path: string;
}

interface RunOptions {
  plan: ReplayPlan;
  tasks: readonly StalenessTask[];
  recordings: string;
  output: string;
  offingCommit: string;
  sandbox?: TaskSandbox;
}

async function attemptsFor(options: RunOptions): Promise<Attempt[]> {
  const { plan, tasks } = options;
  if (new Set(plan.taskIds).size !== plan.taskIds.length || new Set(plan.arms).size !== plan.arms.length) {
    throw new Error("A replay plan cannot repeat a task ID or arm.");
  }
  const folder = await realpath(options.recordings);
  const attempts: Attempt[] = [];
  for (const taskId of plan.taskIds) {
    const task = tasks.find(({ id }) => id === taskId);
    if (!task) throw new Error("Unknown committed benchmark task: " + taskId);
    for (const arm of plan.arms) {
      for (let attempt = 1; attempt <= plan.repeats; attempt += 1) {
        const file = join(folder, arm, task.id, String(attempt) + ".json");
        const stat = await lstat(file);
        if (!stat.isFile() || stat.size > maximumRecordingBytes || !(await realpath(file)).startsWith(folder + sep)) {
          throw new Error("Invalid recording: " + file);
        }
        attempts.push({ task, arm, attempt, path: file });
      }
    }
  }
  return attempts;
}

async function writeProducedTarget(
  bytes: Buffer | undefined,
  target: string,
  destination: string,
): Promise<string | null> {
  if (!bytes) return null;
  const output = join(destination, target);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  return createHash("sha256").update(bytes).digest("hex");
}

async function replayStatic(project: string, recording: string, bytes: Buffer, prompt: string, target: string) {
  await writeFile(recording, bytes);
  const { result } = await createReplayDriver(recording).run({
    prompt,
    worktreePath: project,
    timeoutMs: 10_000,
    allowedPaths: [target],
  });
  return {
    result,
    output: result.filesTouched.includes(target) ? await readRecordedTarget(project, target) : undefined,
  };
}

async function prepareTargetParent(project: string, target: string): Promise<void> {
  if (!validPaths([target])) throw new Error("Invalid agent benchmark target.");
  let directory = project;
  for (const part of target.split("/").slice(0, -1)) {
    directory = join(directory, part);
    const existing = await lstat(directory).catch((error: unknown) => {
      if (record(error)?.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!existing) await mkdir(directory);
    else if (!existing.isDirectory()) throw new Error("The agent benchmark target parent is not a directory.");
  }
}

async function runAttempt(options: RunOptions, entry: Attempt, pin: ScoringPin): Promise<RunMeta> {
  const { plan, output } = options;
  const { task, arm, attempt } = entry;
  const scratch = await mkdtemp(join(tmpdir(), "offing-agent-benchmark-"));
  let fixture: string | undefined;
  try {
    const project = plan.fixture ? (fixture = await materializeExample(plan.fixture)) : join(scratch, "project");
    await mkdir(project, { recursive: true });
    await prepareTargetParent(project, task.target);
    const bytes = await readFile(entry.path);
    const recording = join(scratch, "recording.json");
    const prompt = await sessionPrompt(task, arm, project, plan.identity.agent, plan.asOf);
    const { result, output: produced } = options.sandbox
      ? await replaySandboxTask(options.sandbox, join(scratch, "sandbox"), {
          project,
          prompt,
          target: task.target,
          recording: bytes,
        })
      : await replayStatic(project, recording, bytes, prompt, task.target);
    const destination = join(output, arm, task.id, String(attempt));
    await mkdir(destination, { recursive: true });
    const outputSha256 = await writeProducedTarget(produced, task.target, destination);
    const meta: RunMeta = {
      schemaVersion: "offing.agent-run.v1",
      identity: plan.identity,
      source: plan.source,
      pin,
      arm,
      taskId: task.id,
      attempt,
      replaySha256: createHash("sha256").update(bytes).digest("hex"),
      ...(plan.fixture ? { fixture: plan.fixture } : {}),
      status: result.status,
      outputSha256,
    };
    await Promise.all([
      writeFile(join(destination, "meta.json"), JSON.stringify(meta, null, 2) + "\n"),
      writeFile(join(destination, "result.json"), JSON.stringify(result, null, 2) + "\n"),
      writeFile(join(destination, "prompt.md"), prompt + "\n"),
    ]);
    return meta;
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (fixture) await rm(dirname(fixture), { recursive: true, force: true });
  }
}

/** Replay approved recordings with the selected backend. Neither backend executes the generated target. */
export async function runRecordedExperiment(options: RunOptions): Promise<RunMeta[]> {
  const attempts = await attemptsFor(options);
  const pin = await bundledScoringPin(options.offingCommit, options.plan.asOf);
  await mkdir(options.output);
  try {
    const results: RunMeta[] = [];
    for (const attempt of attempts) results.push(await runAttempt(options, attempt, pin));
    await writeFile(join(options.output, "plan.json"), JSON.stringify(options.plan, null, 2) + "\n", { flag: "wx" });
    return results;
  } catch (error) {
    await rm(options.output, { recursive: true, force: true });
    throw error;
  }
}
