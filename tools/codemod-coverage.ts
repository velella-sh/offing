import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  corpusCachePath,
  describeMissingEntries,
  missingCorpusEntries,
  resolveCorpusCacheDir,
} from "../benchmarks/corpus-cache.js";
import { FETCH_MARKER, isCheckoutUsable } from "../benchmarks/corpus-fetch.js";
import { inBatches, resolveCorpusConcurrency } from "../benchmarks/corpus-harness.js";
import { loadPublicCorpus } from "../benchmarks/public-corpus.js";
import { builtInDetectors } from "../src/detectors/index.js";
import type { Finding, ScanResult } from "../src/domain.js";
import { scanRepository } from "../src/engine/index.js";
import { planFixReport } from "../src/fix/index.js";
import type { FixerPatch } from "../src/fix/index.js";

interface Counters {
  patched: number;
  refused: number;
  unfixed: number;
}

type Counts = Map<string, Counters>;
type Plan = typeof planFixReport;

function tally(counts: Counts, rule: string): Counters {
  const entry = counts.get(rule) ?? { patched: 0, refused: 0, unfixed: 0 };
  counts.set(rule, entry);
  return entry;
}

/** Attribute a proposed patch to one finding at a time, so nearby edits never count as its fix. */
export async function classifyFixCoverage(scan: ScanResult, plan: Plan = planFixReport): Promise<Counts> {
  const counts: Counts = new Map();
  const ambient = new Set((await plan({ ...scan, findings: [] })).patches.map(patchKey));
  for (const finding of scan.findings) {
    const row = tally(counts, finding.ruleId);
    const { patches, refusals } = await plan({ ...scan, findings: [finding] });
    if (patches.some((patch) => addressesFinding(finding, patch.path) && !ambient.has(patchKey(patch)))) row.patched++;
    else if (refusals.some(({ findingId }) => findingId === finding.id)) row.refused++;
    else row.unfixed++;
  }
  return counts;
}

function patchKey(patch: FixerPatch): string {
  return JSON.stringify([patch.fixer, patch.path, patch.diff]);
}

function addressesFinding(finding: Finding, path: string): boolean {
  return path === finding.location.path || (finding.usages ?? []).some(({ location }) => location.path === path);
}

function combine(reports: Counts[]): Counts {
  const total: Counts = new Map();
  for (const report of reports) {
    for (const [rule, counts] of report) {
      const row = tally(total, rule);
      row.patched += counts.patched;
      row.refused += counts.refused;
      row.unfixed += counts.unfixed;
    }
  }
  return total;
}

export function coverageTable(counts: Counts): string {
  const ranked = [...counts].sort(
    ([leftId, left], [rightId, right]) =>
      right.unfixed + right.refused - left.unfixed - left.refused ||
      right.refused - left.refused ||
      leftId.localeCompare(rightId),
  );
  return [
    "| Rule | Patched | Refused | Unfixed |",
    "| --- | ---: | ---: | ---: |",
    ...ranked.map(([id, row]) => `| \`${id}\` | ${row.patched} | ${row.refused} | ${row.unfixed} |`),
  ].join("\n");
}

interface Build {
  scanRepository: typeof scanRepository;
  builtInDetectors: typeof builtInDetectors;
  planFixReport: Plan;
}

async function baselineBuild(path: string): Promise<Build> {
  const readModule = async (file: string): Promise<unknown> => {
    const module: unknown = await import(pathToFileURL(resolve(path, "src", file)).href);
    return module;
  };
  const [engine, detectors, fix] = await Promise.all([
    readModule("engine/index.js"),
    readModule("detectors/index.js"),
    readModule("fix/index.js"),
  ]);
  if (
    !hasExport(engine, "scanRepository") ||
    !hasExport(detectors, "builtInDetectors") ||
    !hasExport(fix, "planFixReport")
  )
    throw new Error("The baseline dist directory is missing its engine, detectors, or fix planner.");
  return {
    scanRepository: engine.scanRepository,
    builtInDetectors: detectors.builtInDetectors,
    planFixReport: fix.planFixReport,
  };
}

function hasExport<Key extends keyof Build>(value: unknown, key: Key): value is Pick<Build, Key> {
  if (typeof value !== "object" || value === null) return false;
  const exported: unknown = Reflect.get(value, key);
  return key === "builtInDetectors" ? Array.isArray(exported) : typeof exported === "function";
}

async function run(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      cache: { type: "string" },
      baseline: { type: "string" },
      output: { type: "string" },
      repo: { type: "string", multiple: true },
      detector: { type: "string", multiple: true },
      "accept-sparse-marker": { type: "string", multiple: true },
      date: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  const cache = values.cache ?? resolveCorpusCacheDir();
  if (!cache) throw new Error("Set OFFING_CORPUS_CACHE or pass --cache to point to exact pinned checkouts.");
  const day = values.date ?? new Date().toISOString().slice(0, 10);
  const scannedAt = new Date(`${day}T00:00:00.000Z`).toISOString();
  if (day !== scannedAt.slice(0, 10)) throw new Error("Expected a valid YYYY-MM-DD date.");
  const selected = new Set(values.detector);
  const wanted = new Set(values.repo);
  if ([...selected].some((name) => !builtInDetectors.some(({ id }) => id === name)))
    throw new Error("Unknown detector.");
  const markers = new Set(values["accept-sparse-marker"]);
  if (markers.size > 0 && selected.size === 0)
    throw new Error("Explicit --detector scope is required when accepting older sparse checkout markers.");
  const corpus = await loadPublicCorpus();
  const repositories = corpus.repositories.filter((entry) => wanted.size === 0 || wanted.has(entry.repository));
  if (wanted.size > 0 && repositories.length !== wanted.size) throw new Error("Unknown pinned corpus repository.");
  const missing = await missingCorpusEntries(cache, repositories, async (path) => {
    if (await isCheckoutUsable(path, "sparse")) return true;
    const marker = (await readFile(resolve(path, FETCH_MARKER), "utf8")).trim();
    return markers.has(marker);
  });
  if (missing.length > 0) throw new Error(describeMissingEntries(missing));

  const build = { scanRepository, builtInDetectors, planFixReport };
  const base = values.baseline ? await baselineBuild(values.baseline) : undefined;
  const settings = { scannedAt, noCache: true };
  async function measure(config: Build, path: string) {
    const detectors = config.builtInDetectors.filter(({ id }) => selected.size === 0 || selected.has(id));
    return classifyFixCoverage(await config.scanRepository(path, detectors, settings), config.planFixReport);
  }
  const concurrency = resolveCorpusConcurrency(
    values.concurrency ? ["--concurrency", values.concurrency] : [],
    process.env,
  );
  const reports = await inBatches(repositories, concurrency, async (entry) => {
    const root = corpusCachePath(cache, entry);
    try {
      const before = base ? await measure(base, root) : new Map<string, Counters>();
      return { before, after: await measure(build, root) };
    } catch (error) {
      throw new Error(`Unable to measure ${entry.repository}@${entry.commit}`, { cause: error });
    }
  });
  const sections = [
    "# Codemod plan coverage",
    `Pinned checkouts measured on ${day}: ${repositories.length} of ${corpus.repositories.length}.`,
    `Detectors: ${selected.size > 0 ? [...selected].sort().join(", ") : "all"}.`,
    ...(markers.size > 0 ? [`Additional accepted sparse markers: ${[...markers].sort().join(", ")}.`] : []),
    ...(base ? ["## Baseline", coverageTable(combine(reports.map(({ before }) => before)))] : []),
    "## Current",
    coverageTable(combine(reports.map(({ after }) => after))),
  ];
  const output = sections.join("\n\n") + "\n";
  if (values.output) await writeFile(values.output, output);
  else process.stdout.write(output);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await run(process.argv.slice(2));
}
