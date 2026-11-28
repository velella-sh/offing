/**
 * Offline scorer for the agent-staleness benchmark.
 *
 * Walks committed (or freshly produced) outputs under `outputs/<agent>/<arm>/<task>/`,
 * scans each task directory with `scanRepository`, and aggregates per agent, arm, and
 * category: share of tasks with at least one finding, findings per task, and rule ids.
 *
 * Never imports `run.ts`, never calls an agent, and never uses the network.
 *
 * Run:
 *   npm run bench:staleness:score
 */

import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Finding } from "../../src/domain.js";
import { builtInDetectors } from "../../src/detectors/index.js";
import { scanRepository } from "../../src/engine/index.js";
import { restoreFixtureNames } from "../../src/fixture-names.js";
import { snippetSymbolFindings } from "../../src/snippet-symbols.js";
import { sourceFileEntries } from "../../src/source-files.js";

export const SCHEMA_VERSION = "offing.agent-staleness.results.v1" as const;

export type StalenessArm = "plain" | "hooks" | "context";

export interface StalenessTask {
  id: string;
  category: string;
  target: string;
  prompt: string;
}

export interface StalenessTasksFile {
  schemaVersion: string;
  tasks: StalenessTask[];
}

interface ScoreFinding {
  ruleId: string;
  location: Finding["location"];
  origin: "scan" | "snippet";
  sources: Finding["sources"];
}

export interface TaskScanScore {
  taskId: string;
  category: string;
  agent: string;
  arm: StalenessArm;
  findingCount: number;
  ruleIds: string[];
  hasFinding: boolean;
  findings?: ScoreFinding[];
}

export interface AggregateScore {
  agent: string;
  arm: StalenessArm;
  category: string;
  tasks: number;
  tasksWithFinding: number;
  shareWithFinding: number;
  findingsPerTask: number;
  ruleIds: string[];
}

export interface StalenessResults {
  schemaVersion: typeof SCHEMA_VERSION;
  scoredAt: string;
  tasks: TaskScanScore[];
  aggregates: AggregateScore[];
}

/** Paths are relative to the repository root (the process cwd when scripts run). */
const TASKS_PATH = resolve("benchmarks/agent-staleness/tasks.json");
const OUTPUTS_PATH = resolve("benchmarks/agent-staleness/outputs");
const RESULTS_PATH = resolve("benchmarks/agent-staleness/results.json");

/** Byte-wise order so aggregates stay identical across locales. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function parseStalenessTasks(raw: string): StalenessTasksFile {
  const parsed = JSON.parse(raw) as StalenessTasksFile;
  if (parsed.schemaVersion !== "offing.agent-staleness.v1") {
    throw new Error(`unsupported tasks schemaVersion: ${parsed.schemaVersion}`);
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("tasks.json must list at least one task");
  }
  return parsed;
}

/** Loads the committed task set from disk (synchronous for unit tests). */
export function loadStalenessTasks(path: string = TASKS_PATH): StalenessTasksFile {
  return parseStalenessTasks(readFileSync(path, "utf8"));
}

export async function loadStalenessTasksAsync(path: string = TASKS_PATH): Promise<StalenessTasksFile> {
  return parseStalenessTasks(await readFile(path, "utf8"));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function attributedFinding({ ruleId, location, sources }: Finding, origin: ScoreFinding["origin"]): ScoreFinding {
  return { ruleId, location, origin, sources };
}

async function collectFindings(root: string, scannedAt?: string): Promise<ScoreFinding[]> {
  const scan = await scanRepository(root, builtInDetectors, { noCache: true, ...(scannedAt ? { scannedAt } : {}) });
  const findings = new Map<string, ScoreFinding>();
  const add = (finding: ScoreFinding) => {
    const { path, line } = finding.location;
    const key = JSON.stringify([finding.ruleId, path, line]);
    if (!findings.has(key)) findings.set(key, finding);
  };
  for (const finding of scan.findings) add(attributedFinding(finding, "scan"));

  const include = (language: string) => language === "javascript" || language === "typescript" || language === "python";
  for await (const file of sourceFileEntries(root, { include })) {
    const contents = await readFile(file.absolutePath, "utf8");
    for (const finding of await snippetSymbolFindings(file.path, contents, "removed")) {
      add(attributedFinding(finding, "snippet"));
    }
  }

  return [...findings.values()].sort(
    (left, right) =>
      compareText(left.location.path, right.location.path) ||
      (left.location.line ?? 0) - (right.location.line ?? 0) ||
      compareText(left.ruleId, right.ruleId),
  );
}

/**
 * Copy a task output tree, restore scanner-neutral fixture names (decision 0027), then scan.
 * Seed outputs store `image.fixture` instead of `Dockerfile` so Scorecard does not alert on them.
 */
async function scanRestoredTaskRoot(source: string, scannedAt?: string, target?: { path: string; bytes: Buffer }) {
  const root = await mkdtemp(join(tmpdir(), "offing-staleness-"));
  try {
    if (target) {
      const path = join(root, target.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, target.bytes);
    } else {
      await cp(source, root, { recursive: true });
    }
    await restoreFixtureNames(root);
    return await collectFindings(root, scannedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Score one already-materialized task directory by scanning it offline. */
export async function scoreTaskDirectory(input: {
  root: string;
  taskId: string;
  category: string;
  agent: string;
  arm: StalenessArm;
  scannedAt?: string;
  includeEvidence?: boolean;
  target?: { path: string; bytes: Buffer };
}): Promise<TaskScanScore> {
  const findings = await scanRestoredTaskRoot(input.root, input.scannedAt, input.target);
  const ruleIds = uniqueSorted(findings.map((finding) => finding.ruleId));
  return {
    taskId: input.taskId,
    category: input.category,
    agent: input.agent,
    arm: input.arm,
    findingCount: findings.length,
    ruleIds,
    hasFinding: findings.length > 0,
    ...(input.includeEvidence ? { findings } : {}),
  };
}

export function aggregateScores(scores: readonly TaskScanScore[]): AggregateScore[] {
  const groups = new Map<string, TaskScanScore[]>();
  for (const score of scores) {
    const key = `${score.agent}\0${score.arm}\0${score.category}`;
    const list = groups.get(key);
    if (list) list.push(score);
    else groups.set(key, [score]);
  }
  const aggregates: AggregateScore[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const tasksWithFinding = group.filter((item) => item.hasFinding).length;
    const findingTotal = group.reduce((sum, item) => sum + item.findingCount, 0);
    aggregates.push({
      agent: first.agent,
      arm: first.arm,
      category: first.category,
      tasks: group.length,
      tasksWithFinding,
      shareWithFinding: roundRate(tasksWithFinding / group.length),
      findingsPerTask: roundRate(findingTotal / group.length),
      ruleIds: uniqueSorted(group.flatMap((item) => item.ruleIds)),
    });
  }
  return aggregates.sort(
    (left, right) =>
      compareText(left.agent, right.agent) ||
      compareText(left.arm, right.arm) ||
      compareText(left.category, right.category),
  );
}

function isArm(value: string): value is StalenessArm {
  return value === "plain" || value === "hooks";
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareText);
}

/** Discover and score every `outputs/<agent>/<arm>/<task>/` directory that matches a known task. */
export async function scoreOutputs(
  options: { outputsPath?: string; tasks?: StalenessTasksFile } = {},
): Promise<StalenessResults> {
  const tasks = options.tasks ?? (await loadStalenessTasksAsync());
  const byId = new Map(tasks.tasks.map((task) => [task.id, task]));
  const outputsPath = options.outputsPath ?? OUTPUTS_PATH;
  const scores: TaskScanScore[] = [];

  for (const agent of await listDirectories(outputsPath)) {
    const agentPath = join(outputsPath, agent);
    for (const armName of await listDirectories(agentPath)) {
      if (!isArm(armName)) continue;
      const armPath = join(agentPath, armName);
      for (const taskId of await listDirectories(armPath)) {
        const task = byId.get(taskId);
        if (task === undefined) continue;
        scores.push(
          await scoreTaskDirectory({
            root: join(armPath, taskId),
            taskId,
            category: task.category,
            agent,
            arm: armName,
          }),
        );
      }
    }
  }

  scores.sort(
    (left, right) =>
      compareText(left.agent, right.agent) ||
      compareText(left.arm, right.arm) ||
      compareText(left.taskId, right.taskId),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    scoredAt: "offline",
    tasks: scores,
    aggregates: aggregateScores(scores),
  };
}

/** Stable Markdown table for docs and CLI output. */
export function formatResultsTable(results: StalenessResults): string {
  const header =
    "| Agent | Arm | Category | Tasks | Tasks with finding | Share | Findings / task | Rule ids |\n| --- | --- | --- | ---: | ---: | ---: | ---: | --- |";
  if (results.aggregates.length === 0) {
    return `${header}\n| _(none)_ |  |  | 0 | 0 | 0 | 0 |  |`;
  }
  const rows = results.aggregates.map((row) => {
    const rules = row.ruleIds.length === 0 ? "—" : row.ruleIds.join(", ");
    return `| ${row.agent} | ${row.arm} | ${row.category} | ${row.tasks} | ${row.tasksWithFinding} | ${row.shareWithFinding.toFixed(4)} | ${row.findingsPerTask.toFixed(4)} | ${rules} |`;
  });
  return [header, ...rows].join("\n");
}

export async function writeResults(results: StalenessResults, path: string = RESULTS_PATH): Promise<void> {
  const payload = `${JSON.stringify(results, null, 2)}\n`;
  await writeFile(path, payload, "utf8");
}

async function main(argv: readonly string[]): Promise<number> {
  const writeFlag = argv.includes("--write");
  const results = await scoreOutputs();
  const table = formatResultsTable(results);
  process.stdout.write(`${table}\n`);
  process.stdout.write(
    `\nScored ${results.tasks.length} task output(s); ${results.aggregates.length} aggregate row(s).\n`,
  );
  if (writeFlag) {
    await writeResults(results);
    process.stdout.write(`Wrote ${RESULTS_PATH}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
