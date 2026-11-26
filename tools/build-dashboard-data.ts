// Builds docs/_data/dashboard.json (and the flattened collection sources under docs/_data/): the numbers
// behind the public accuracy dashboard, from committed files only.
//
//   npm run build --silent
//   node dist/tools/build-dashboard-data.js --today 2026-10-18     # writes docs/_data/dashboard*.json (gitignored; Pages builds it)
//   node dist/tools/build-dashboard-data.js --today run-date       # the reference day is lastFullRun.date
//   node dist/tools/build-dashboard-data.js --today run-date --check
//
// Inputs are benchmarks/thresholds.json, benchmarks/corpus-targets.json, and benchmarks/public-repositories/.
// The tool never reads the clock and never uses the network: the reference day is the required --today argument,
// and it is written into the output. `run-date` pins the reference day to the last full run so the published
// file does not change with the clock.
// The file is not committed: the Pages workflow generates it before Mizzen builds. Local `npm run build:dashboard`
// writes the same path for preview. Output is deterministic: the same inputs and the same day give the same bytes.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readCorpusArchive } from "../benchmarks/corpus-run-archive.js";
import type { ArchivedCorpusRun } from "../benchmarks/corpus-run-archive.js";
import { buildDashboardAccuracy, HELD_OUT_RESULT_FILE } from "./dashboard-accuracy.js";
import type { HeldOutResult } from "./dashboard-accuracy.js";

import { corpusCounts, loadCorpusTargets, TARGETS_PATH } from "../benchmarks/corpus-targets.js";
import type { CorpusTargets } from "../benchmarks/corpus-targets.js";
import { loadPublicCorpus, PUBLIC_CORPUS_DIR } from "../benchmarks/public-corpus.js";
import { countEvidence, earnedLevel, evidenceMinimums } from "../benchmarks/thresholds.js";
import type { Evidence, MaturityLevel, Thresholds } from "../benchmarks/thresholds.js";

export const DASHBOARD_SCHEMA = "offing.dashboard-data.v1";
export const THRESHOLDS_FILE = "benchmarks/thresholds.json";
export const CORPUS_FILE = PUBLIC_CORPUS_DIR;
export const TARGETS_FILE = TARGETS_PATH;
export const DECISION_FILE = "docs/decisions/0013-detector-maturity.md";
export const TARGET_DECISION_FILE = "docs/decisions/0030-corpus-selection-and-200-target.md";
export const OUTPUT_FILE = "docs/_data/dashboard.json";
export const DETECTORS_COLLECTION_FILE = "docs/_data/dashboard-detectors.json";
export const ECOSYSTEMS_COLLECTION_FILE = "docs/_data/dashboard-ecosystems.json";
export const MINIMUMS_COLLECTION_FILE = "docs/_data/dashboard-minimums.json";
export const RUN_COLLECTION_FILE = "docs/_data/dashboard-run.json";
const ACCURACY_COLLECTION_FILE = "docs/_data/dashboard-accuracy-ecosystems.json";
const MATURITY_COLLECTION_FILE = "docs/_data/dashboard-maturity.json";
const COMPARISON_COLLECTION_FILE = "docs/_data/dashboard-comparison.json";

/** The corpus ecosystems each detector reads, which is what its zero-finding repositories are counted over. */
export const detectorEcosystems: Readonly<Record<string, readonly string[]>> = {
  android: ["android"],
  "ci-images": ["ci-images"],
  container: ["container"],
  cpp: ["cpp"],
  dart: ["dart"],
  database: ["database"],
  deno: ["deno"],
  shell: ["shell"],
  dotnet: ["dotnet"],
  elixir: ["elixir"],
  "github-actions": ["node-actions"],
  go: ["go"],
  java: ["java"],
  kubernetes: ["kubernetes"],
  nodejs: ["node"],
  npm: ["node"],
  php: ["php"],
  python: ["python"],
  ruby: ["ruby"],
  rust: ["rust"],
  scala: ["scala"],
  serverless: ["serverless"],
  swift: ["swift"],
  terraform: ["terraform"],
};

export interface CorpusRepository {
  repository: string;
  ecosystem: string;
  expected: ReadonlyArray<{ ruleId: string }>;
}

export interface DetectorCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** truePositives / (truePositives + falsePositives); null when that denominator is zero. */
  precision: number | null;
  /** truePositives / (truePositives + falseNegatives); null when that denominator is zero. */
  recall: number | null;
}

export interface DashboardDetector {
  id: string;
  level: MaturityLevel;
  earnedLevel: MaturityLevel;
  precisionFloor: { value: number; enforced: boolean };
  /** null when the last full run has no entry for the detector. */
  run: DetectorCounts | null;
  evidence: Evidence;
}

export interface DashboardRun {
  date: string;
  commit: string;
  repositories: number;
  findings: number;
  /** Whole days from `date` to the reference day. */
  runAgeDays: number;
  recordedPrecision: number;
  recordedRecall: number;
  timing: { medianScanMs: null; p95ScanMs: null; note: string };
}

export interface MetricDefinition {
  label: string;
  meaning: string;
  computation: string;
  source: string;
}

export interface DashboardEcosystem {
  id: string;
  /** Pinned repositories in this corpus bucket. */
  repositories: number;
  /** The committed floor CI enforces; never below it without a reviewable targets change. */
  minimum: number;
  /** The growth goal per bucket in decision 0030. */
  target: number;
}

export interface DashboardData {
  schemaVersion: typeof DASHBOARD_SCHEMA;
  referenceDay: string;
  corpus: { file: string; repositories: number; ecosystems: DashboardEcosystem[] };
  sources: { thresholds: string; corpus: string; targets: string; decision: string };
  /** null when benchmarks/thresholds.json records no full run. */
  run: DashboardRun | null;
  detectors: DashboardDetector[];
  accuracy: ReturnType<typeof buildDashboardAccuracy>;
  evidenceMinimums: typeof evidenceMinimums;
  definitions: Record<string, MetricDefinition>;
  limitations: string[];
}

export const limitations: readonly string[] = [
  "A precision of 1.0 means no regression against this corpus. The expected findings were written by reviewing the same commits, so it does not show that the detectors generalize to unseen repositories. See ADR 0013 and issue #740.",
  "Trends use archived verify runs. The number of pinned repositories and the Ebb version may change between runs.",
  "Scan time is not measured here. Median and p95 scan times are printed by the corpus harness but are not recorded in a committed file, so the dashboard does not show them.",
  "Evidence counts describe the current corpus files. Recorded run counts have their own provenance. The configured level is a promise recorded in benchmarks/thresholds.json; the earned level counts evidence only and does not check recall or blind selection, which the corpus does not record yet.",
  "A detector's configured level can be higher than its earned level: ADR 0013 lets the detectors that held the Supported label before the evidence rules existed keep it until the corpus grows.",
  "The corpus minimum is the committed floor CI enforces, not the 200-repository goal. Most buckets are below the goal, so a bucket above its minimum can still be far from 200; decision 0030 owns the goal.",
];

export const definitions: Readonly<Record<string, MetricDefinition>> = {
  level: {
    label: "Level",
    meaning: "What the detector promises users: experimental, beta, or stable (shown in the docs as Supported).",
    computation:
      "Copied from the detector's entry in benchmarks/thresholds.json. A maintainer changes it in a pull request; nothing computes it.",
    source: THRESHOLDS_FILE,
  },
  earnedLevel: {
    label: "Earned level",
    meaning: "The highest level the counted corpus evidence supports.",
    computation:
      "earnedLevel() in benchmarks/thresholds.ts applied to the three evidence counts below, against the minimums in ADR 0013. It does not check precision, recall, or blind selection.",
    source: DECISION_FILE,
  },
  precisionFloor: {
    label: "Precision floor",
    meaning: "The lowest precision the corpus run may show for the detector before CI fails.",
    computation:
      "minPrecision from the detector's entry in benchmarks/thresholds.json. It is enforced for beta and stable detectors and only reported for experimental ones.",
    source: THRESHOLDS_FILE,
  },
  precision: {
    label: "Precision",
    meaning: "Of the findings the detector reported in the last full run, the share that the corpus lists as expected.",
    computation:
      "truePositives / (truePositives + falsePositives), rounded to 4 decimals. Not measured when the denominator is zero. (The corpus harness treats an empty result as 1 so it never counts as a regression; the dashboard does not.)",
    source: THRESHOLDS_FILE,
  },
  recall: {
    label: "Recall",
    meaning:
      "Of the findings the corpus lists as expected for the detector, the share it reported in the last full run.",
    computation:
      "truePositives / (truePositives + falseNegatives), rounded to 4 decimals. Not measured when the denominator is zero.",
    source: THRESHOLDS_FILE,
  },
  truePositives: {
    label: "True positives",
    meaning: "Findings the detector reported that the corpus lists as expected.",
    computation: "perDetector.<detector>.truePositives in the lastFullRun record.",
    source: THRESHOLDS_FILE,
  },
  falsePositives: {
    label: "False positives",
    meaning: "Findings the detector reported that the corpus does not list.",
    computation: "perDetector.<detector>.falsePositives in the lastFullRun record.",
    source: THRESHOLDS_FILE,
  },
  falseNegatives: {
    label: "False negatives",
    meaning: "Findings the corpus lists that the detector did not report.",
    computation: "perDetector.<detector>.falseNegatives in the lastFullRun record.",
    source: THRESHOLDS_FILE,
  },
  repositoriesWithFindings: {
    label: "Repositories with findings",
    meaning: "Corpus repositories with at least one expected finding of this detector.",
    computation:
      "countEvidence() in benchmarks/thresholds.ts over the corpus entries' expected findings, grouped by the first segment of the rule id.",
    source: CORPUS_FILE,
  },
  expectedFindings: {
    label: "Expected findings",
    meaning: "Findings of this detector that the corpus lists as expected.",
    computation:
      "countEvidence() in benchmarks/thresholds.ts: the number of expected findings whose rule id belongs to the detector.",
    source: CORPUS_FILE,
  },
  zeroFindingRepositories: {
    label: "Zero-finding repositories",
    meaning:
      "Corpus repositories of the detector's ecosystem that have no expected findings at all, so a report there would be a false positive.",
    computation:
      "countEvidence() in benchmarks/thresholds.ts: entries of the detector's corpus ecosystems with an empty expected list. Detectors that read the same ecosystem share this count.",
    source: CORPUS_FILE,
  },
  runAge: {
    label: "Run age",
    meaning: "How many days before the reference day the last full run happened.",
    computation:
      "The whole days between lastFullRun.date and the reference day given to the build with --today. It is fixed when the file is built, never read from a clock.",
    source: THRESHOLDS_FILE,
  },
  scanTime: {
    label: "Scan time",
    meaning: "Median and p95 time of a local scan.",
    computation: "Not measured: the corpus harness prints these numbers but no committed file records them.",
    source: "benchmarks/public-repositories.ts",
  },
  corpusRepositories: {
    label: "Repositories",
    meaning: "Pinned public repositories in this ecosystem bucket.",
    computation:
      "The number of corpus entries under benchmarks/public-repositories/<bucket>/. The bucket names come from the candidate finder's profiles.",
    source: CORPUS_FILE,
  },
  corpusMinimum: {
    label: "Minimum",
    meaning: "The fewest pinned repositories this bucket may keep before CI fails.",
    computation:
      "The committed value in benchmarks/corpus-targets.json. It starts at the count when the check landed and rises as the corpus grows; a reduction needs a reviewable change to that file.",
    source: TARGETS_FILE,
  },
  corpusTarget: {
    label: "Target",
    meaning: "The reviewed-project goal per bucket.",
    computation:
      "The target recorded in benchmarks/corpus-targets.json, set to the 200 repositories per bucket in decision 0030. It is a goal, not a floor: most buckets are still below it.",
    source: TARGET_DECISION_FILE,
  },
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

export function detectorCounts(counts: {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}): DetectorCounts {
  return {
    truePositives: counts.truePositives,
    falsePositives: counts.falsePositives,
    falseNegatives: counts.falseNegatives,
    precision: ratio(counts.truePositives, counts.truePositives + counts.falsePositives),
    recall: ratio(counts.truePositives, counts.truePositives + counts.falseNegatives),
  };
}

const parseDay = (value: string, name: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
  if (!match || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error(`${name} must be a calendar day written YYYY-MM-DD, not "${value}".`);
  return time;
};

export function ageInDays(runDate: string, today: string): number {
  const days = (parseDay(today, "--today") - parseDay(runDate, "lastFullRun.date")) / 86_400_000;
  if (days < 0) throw new Error(`--today ${today} is before the last full run on ${runDate}.`);
  return days;
}

const byCodePoint = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function buildDashboardData(input: {
  thresholds: Thresholds;
  corpus: readonly CorpusRepository[];
  targets: CorpusTargets;
  today: string;
  archives?: readonly ArchivedCorpusRun[];
  heldOut?: HeldOutResult;
}): DashboardData {
  const { thresholds, corpus, targets, today } = input;
  const lastRun = thresholds.lastFullRun;
  const counts = corpusCounts({ repositories: corpus });
  const ecosystems = Object.keys(counts).map(
    (id): DashboardEcosystem => ({
      id,
      repositories: counts[id] ?? 0,
      minimum: targets.minimum[id] ?? 0,
      target: targets.target,
    }),
  );
  const detectors = Object.keys(thresholds.detectors)
    .sort(byCodePoint)
    .map((id): DashboardDetector => {
      const ecosystems = detectorEcosystems[id];
      if (!ecosystems)
        throw new Error(`Detector "${id}" in ${THRESHOLDS_FILE} has no corpus ecosystem in detectorEcosystems.`);
      const threshold = thresholds.detectors[id]!;
      const evidence = countEvidence(corpus, id, ecosystems);
      const runCounts = lastRun?.perDetector[id];
      return {
        id,
        level: threshold.level,
        earnedLevel: earnedLevel(evidence),
        precisionFloor: { value: threshold.minPrecision, enforced: threshold.stable },
        run: runCounts ? detectorCounts(runCounts) : null,
        evidence,
      };
    });
  const run: DashboardRun | null = lastRun
    ? {
        date: lastRun.date,
        commit: lastRun.commit,
        repositories: lastRun.repositories,
        findings: lastRun.findings,
        runAgeDays: ageInDays(lastRun.date, today),
        recordedPrecision: lastRun.precision,
        recordedRecall: lastRun.recall,
        timing: { medianScanMs: null, p95ScanMs: null, note: "not measured" },
      }
    : (parseDay(today, "--today"), null);
  return {
    schemaVersion: DASHBOARD_SCHEMA,
    referenceDay: today,
    corpus: { file: CORPUS_FILE, repositories: corpus.length, ecosystems },
    sources: {
      thresholds: THRESHOLDS_FILE,
      corpus: CORPUS_FILE,
      targets: TARGETS_FILE,
      decision: DECISION_FILE,
    },
    run,
    detectors,
    accuracy: buildDashboardAccuracy(thresholds, Object.keys(counts), input.archives ?? [], input.heldOut),
    evidenceMinimums,
    definitions: { ...definitions },
    limitations: [...limitations],
  };
}

export async function buildDashboardDataFromRoot(root: string, today: string): Promise<DashboardData> {
  const rawThresholds: unknown = JSON.parse(await readFile(resolve(root, THRESHOLDS_FILE), "utf8"));
  const thresholds = rawThresholds as Thresholds;
  const targets = await loadCorpusTargets(root);
  const corpus = (await loadPublicCorpus(root)).repositories;
  const archives = await readCorpusArchive(root);
  const heldOut = JSON.parse(await readFile(resolve(root, HELD_OUT_RESULT_FILE), "utf8")) as HeldOutResult;
  const day = today === "run-date" ? thresholds.lastFullRun?.date : today;
  if (day === undefined) throw new Error(`--today run-date needs a lastFullRun in ${THRESHOLDS_FILE}.`);
  return buildDashboardData({ thresholds, corpus, targets, today: day, archives, heldOut });
}

export async function renderDashboardData(root: string, today: string): Promise<string> {
  return `${JSON.stringify(await buildDashboardDataFromRoot(root, today), null, 2)}\n`;
}

/** True when the rendered dashboard JSON has the shape Pages must publish. */
export function isWellFormedDashboardData(text: string, expectedReferenceDay?: string): boolean {
  if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return false;
    const data = parsed as {
      schemaVersion?: unknown;
      referenceDay?: unknown;
      corpus?: { ecosystems?: unknown };
    };
    if (data.schemaVersion !== DASHBOARD_SCHEMA) return false;
    if (typeof data.referenceDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.referenceDay)) return false;
    if (expectedReferenceDay !== undefined && data.referenceDay !== expectedReferenceDay) return false;
    if (!Array.isArray(data.corpus?.ecosystems)) return false;
    return true;
  } catch {
    return false;
  }
}

function todayArgument(args: readonly string[]): string {
  const index = args.indexOf("--today");
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--today is required: a day written YYYY-MM-DD, or run-date for the date of the last full run.");
  }
  return value;
}

export function renderDashboardCollections(data: DashboardData): Record<string, string> {
  const detectors = data.detectors.map((detector) => ({
    id: detector.id,
    ...data.accuracy.provenance,
    level: detector.level,
    earnedLevel: detector.earnedLevel,
    aboveEvidence:
      detector.level === "stable" && detector.earnedLevel !== "stable"
        ? "above the counted evidence, kept by decision 0013"
        : "supported by counted evidence",
    precision: detector.run?.precision ?? "not measured",
    recall: detector.run?.recall ?? "not measured",
    truePositives: detector.run?.truePositives ?? "not measured",
    falsePositives: detector.run?.falsePositives ?? "not measured",
    falseNegatives: detector.run?.falseNegatives ?? "not measured",
    repositoriesWithFindings: detector.evidence.repositoriesWithFindings,
    expectedFindings: detector.evidence.expectedFindings,
    zeroFindingRepositories: detector.evidence.zeroFindingRepositories,
  }));
  const ecosystems = data.corpus.ecosystems.map((entry) => ({
    id: entry.id,
    repositories: entry.repositories,
    minimum: entry.minimum,
    target: entry.target,
  }));
  const minimums = Object.entries(data.evidenceMinimums).map(([level, req]) => ({
    id: level,
    repositoriesWithFindings: req.repositoriesWithFindings,
    expectedFindings: req.expectedFindings,
    zeroFindingRepositories: req.zeroFindingRepositories,
  }));
  const run = data.run
    ? [
        {
          id: "last-full-run",
          date: data.run.date,
          commit: data.run.commit,
          ebbVersion: data.accuracy.provenance.ebbVersion,
          repositories: data.run.repositories,
          findings: data.run.findings,
          runAgeDays: data.run.runAgeDays,
          staleStatus: data.run.runAgeDays > 14 ? "stale" : "fresh",
          recordedPrecision: data.run.recordedPrecision,
          recordedRecall: data.run.recordedRecall,
          medianScanMs: data.run.timing.medianScanMs ?? "not measured",
          p95ScanMs: data.run.timing.p95ScanMs ?? "not measured",
        },
      ]
    : [];
  return {
    [DETECTORS_COLLECTION_FILE]: format(detectors),
    [ECOSYSTEMS_COLLECTION_FILE]: format(ecosystems),
    [MINIMUMS_COLLECTION_FILE]: format(minimums),
    [RUN_COLLECTION_FILE]: format(run),
    ...renderAccuracyCollections(data),
  };
}

const format = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const displayScores = (scores: { precision: number | null; recall: number | null } | null) => ({
  precision: scores?.precision ?? "not measured",
  recall: scores?.recall ?? "not measured",
});

function renderAccuracyCollections(data: DashboardData): Record<string, string> {
  const rows = data.accuracy.ecosystems.map(({ scores, misses, trend, ...row }, index) => ({
    ...row,
    ...scores,
    ...displayScores(scores),
    misses: misses.length ? misses.join("\n") : "No archived misses for this ecosystem.",
    trend: trendMarkdown(trend, index),
  }));
  const maturity = data.accuracy.maturity.map(({ scores, ...row }) => ({
    ...row,
    ...scores,
    ...displayScores(scores),
  }));
  const comparison = data.accuracy.comparison.map((row) => ({ ...row, ...displayScores(row) }));
  return {
    [ACCURACY_COLLECTION_FILE]: format(rows),
    [MATURITY_COLLECTION_FILE]: format(maturity),
    [COMPARISON_COLLECTION_FILE]: format(comparison),
  };
}

function trendMarkdown(trend: DashboardData["accuracy"]["ecosystems"][number]["trend"], index: number): string {
  if (trend.length < 2) return "Trend requires two runs with measured precision and recall.";
  const chart = `::line-chart{from="dashboard.accuracy.ecosystems.${index}.trend" category="run" value="precision,recall" title="Precision and recall by recorded run"}`;
  const provenance = trend.map(
    ({ run, date, commit, ebbVersion, repositories }) =>
      `- Run ${run} · ${date} · [${commit.slice(0, 7)}](https://github.com/velella-sh/offing/commit/${commit}) · Ebb ${ebbVersion} · ${repositories} repositories`,
  );
  return [chart, "", ...provenance].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const today = todayArgument(args);
  const target = resolve(OUTPUT_FILE);
  buildDashboardDataFromRoot(".", today).then(
    async (data) => {
      const text = `${JSON.stringify(data, null, 2)}\n`;
      if (args.includes("--check")) {
        const expectedDay = today === "run-date" ? data.referenceDay : today;
        if (!isWellFormedDashboardData(text, expectedDay)) {
          process.stderr.write(`${OUTPUT_FILE} would be malformed. Fix benchmarks/thresholds.json or the corpus.\n`);
          process.exit(1);
        }
        process.stdout.write(`${OUTPUT_FILE} is buildable (${text.length} characters)\n`);
        return;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
      const collections = renderDashboardCollections(data);
      for (const [path, contents] of Object.entries(collections)) {
        await writeFile(resolve(path), contents);
      }
      process.stdout.write(`Wrote ${target} and collection sources (${text.length} characters)\n`);
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
