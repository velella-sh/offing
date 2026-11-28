import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { scoreTaskDirectory, type StalenessTask, type TaskScanScore } from "../agent-staleness/score.js";
import { wilsonInterval } from "../manual-review/stats.js";
import {
  armSchema,
  assertMatchingPin,
  bundledScoringPin,
  metaSchema,
  planSchema,
  readRecordedTarget,
  type RunMeta,
  type ScoringPin,
} from "./contract.js";

interface RecordPath {
  meta: RunMeta;
  path: string;
}

async function directories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}

async function readJson(root: string, file: string): Promise<unknown> {
  const data = await readRecordedTarget(root, file);
  if (!data) throw new Error("Missing or invalid recorded file: " + join(root, file));
  return JSON.parse(data.toString("utf8"));
}

async function readRecords(root: string): Promise<RecordPath[]> {
  const plan = planSchema.parse(await readJson(root, "plan.json"));
  const records: RecordPath[] = [];
  for (const arm of await directories(root)) {
    armSchema.parse(arm);
    for (const task of await directories(join(root, arm))) {
      for (const attempt of await directories(join(root, arm, task))) {
        const path = join(root, arm, task, attempt);
        const meta = metaSchema.parse(await readJson(path, "meta.json"));
        if (meta.arm !== arm || meta.taskId !== task || String(meta.attempt) !== attempt) {
          throw new Error("Run metadata does not match its directory: " + path);
        }
        if (
          !plan.arms.includes(meta.arm) ||
          !plan.taskIds.includes(meta.taskId) ||
          meta.attempt > plan.repeats ||
          meta.source !== plan.source ||
          meta.fixture !== plan.fixture ||
          meta.pin.asOf !== plan.asOf ||
          !isDeepStrictEqual(meta.identity, plan.identity)
        )
          throw new Error("Run metadata does not match the replay plan: " + path);
        records.push({ meta, path });
      }
    }
  }
  if (records.length !== plan.taskIds.length * plan.arms.length * plan.repeats) {
    throw new Error("Incomplete replay experiment: " + root);
  }
  return records;
}

interface ScoredAttempt {
  meta: RunMeta;
  score?: TaskScanScore;
}

function summarizeAttempts(attempts: readonly ScoredAttempt[]) {
  const groups = new Map<string, ScoredAttempt[]>();
  for (const attempt of attempts) {
    const { identity, source, arm, fixture } = attempt.meta;
    const key = JSON.stringify([identity, source, arm, fixture]);
    const group = groups.get(key);
    if (group) group.push(attempt);
    else groups.set(key, [attempt]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([, group]) => {
      const first = group[0];
      if (!first) return [];
      const { identity, source, arm, fixture } = first.meta;
      const scored = group.filter(({ score }) => score !== undefined);
      const withFinding = scored.filter(({ score }) => score?.hasFinding).length;
      return [
        {
          identity,
          source,
          arm,
          ...(fixture ? { fixture } : {}),
          attempts: group.length,
          completedOutputs: scored.length,
          outputsWithFinding: withFinding,
          interval95: wilsonInterval(withFinding, scored.length),
        },
      ];
    });
}

async function scoreRecordedAttempt(
  record: RecordPath,
  tasks: readonly StalenessTask[],
  pin: ScoringPin,
): Promise<ScoredAttempt> {
  const { meta, path } = record;
  const task = tasks.find(({ id }) => id === meta.taskId);
  if (!task) throw new Error("Unknown committed benchmark task: " + meta.taskId);
  if (meta.status !== "completed" || !meta.outputSha256) return { meta };
  const bytes = await readRecordedTarget(path, task.target);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== meta.outputSha256) {
    throw new Error("Recorded output digest does not match: " + path);
  }
  return {
    meta,
    score: await scoreTaskDirectory({
      root: path,
      taskId: task.id,
      category: task.category,
      agent: meta.identity.agent,
      arm: meta.arm,
      scannedAt: pin.asOf + "T00:00:00.000Z",
      includeEvidence: true,
      target: { path: task.target, bytes },
    }),
  };
}

/** Check every record before scanning any output. This path never invokes an agent. */
export async function rescoreRecordedOutputs(
  roots: readonly string[],
  tasks: readonly StalenessTask[],
  offingCommit?: string,
  requiredSource?: RunMeta["source"],
) {
  const records = (await Promise.all(roots.map(readRecords))).flat();
  const first = records[0];
  if (!first) throw new Error("Pass at least one recorded output directory.");
  if (requiredSource && records.some(({ meta }) => meta.source !== requiredSource)) {
    throw new Error(`The leaderboard requires ${requiredSource} provenance for every attempt.`);
  }
  const pin = await bundledScoringPin(offingCommit ?? first.meta.pin.offingCommit, first.meta.pin.asOf);
  const seen = new Set<string>();
  for (const { meta } of records) {
    assertMatchingPin(pin, meta.pin);
    const key = JSON.stringify([meta.identity, meta.source, meta.fixture, meta.arm, meta.taskId, meta.attempt]);
    if (seen.has(key)) throw new Error("Duplicate attempt: " + meta.taskId + "/" + meta.arm + "/" + meta.attempt);
    seen.add(key);
  }
  const attempts: ScoredAttempt[] = [];
  for (const record of records) attempts.push(await scoreRecordedAttempt(record, tasks, pin));
  return { schemaVersion: "offing.agent-replay-results.v1", pin, attempts, arms: summarizeAttempts(attempts) };
}
