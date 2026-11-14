/**
 * Proves incremental scan reuse on the public corpus: a warm unchanged rerun must return
 * identical findings to a full scan and finish at least ten times faster on aggregate.
 *
 * Requires a warm checkout cache (`OFFING_CORPUS_CACHE` + `npm run corpus:warm`), then:
 *   npm run build --silent && node dist/benchmarks/scan-cache-speed.js --offline [--repo owner/name]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { builtInDetectors } from "../src/detectors/index.js";
import { scanRepository } from "../src/engine/index.js";
import { ensureCorpusCacheEntry, resolveCorpusCacheDir } from "./corpus-cache.js";
import { fetchWith, isCheckoutUsable, resolveFetchStrategy } from "./corpus-fetch.js";
import { parseCorpusFilter, selectCorpusEntries } from "./corpus-filter.js";
import { loadPublicCorpus } from "./public-corpus.js";
import type { CorpusRepositoryEntry } from "./corpus-harness.js";

export const SCAN_CACHE_SPEEDUP_FLOOR = 10;

export interface RepoSpeedMeasurement {
  readonly repository: string;
  readonly coldMs: number;
  readonly warmMs: number;
  readonly speedup: number;
  readonly findings: number;
  readonly identical: boolean;
}

export interface ScanCacheSpeedResult {
  readonly schemaVersion: "offing.scan-cache-speed.v1";
  readonly repositories: readonly RepoSpeedMeasurement[];
  readonly aggregateSpeedup: number;
  readonly allIdentical: boolean;
  readonly withinBudget: boolean;
}

function findingIds(result: Awaited<ReturnType<typeof scanRepository>>): string {
  return JSON.stringify(result.findings.map((finding) => finding.id).sort());
}

async function measureRepository(
  path: string,
  cacheDirectory: string,
): Promise<Omit<RepoSpeedMeasurement, "repository">> {
  const pinned = "2026-01-01T00:00:00.000Z";
  const coldStarted = performance.now();
  const cold = await scanRepository(path, builtInDetectors, {
    cacheDirectory,
    noCache: true,
    scannedAt: pinned,
  });
  const coldMs = performance.now() - coldStarted;

  await scanRepository(path, builtInDetectors, { cacheDirectory, scannedAt: pinned });

  const warmStarted = performance.now();
  const warm = await scanRepository(path, builtInDetectors, { cacheDirectory, scannedAt: pinned });
  const warmMs = performance.now() - warmStarted;

  return {
    coldMs,
    warmMs,
    speedup: coldMs / Math.max(warmMs, 0.001),
    findings: cold.findings.length,
    identical: findingIds(cold) === findingIds(warm),
  };
}

export async function runScanCacheSpeed(
  entries: readonly CorpusRepositoryEntry[],
  options: { offline?: boolean } = {},
): Promise<ScanCacheSpeedResult> {
  const cacheDir = resolveCorpusCacheDir();
  if (!cacheDir) {
    throw new Error(`Set ${"OFFING_CORPUS_CACHE"} to a warm checkout cache before proving scan-cache speed.`);
  }
  const offline = options.offline === true || process.argv.includes("--offline");
  const strategy = resolveFetchStrategy();
  const measurements: RepoSpeedMeasurement[] = [];
  const scanCacheRoot = await mkdtemp(join(tmpdir(), "offing-scan-cache-speed-"));

  try {
    for (const entry of entries) {
      const checkout = await ensureCorpusCacheEntry(
        cacheDir,
        entry,
        async (directory) => {
          if (offline) throw new Error(`Missing cached checkout for ${entry.repository}; run corpus:warm first.`);
          await fetchWith(strategy, directory, entry);
        },
        (existing) => isCheckoutUsable(existing, strategy),
      );
      const measured = await measureRepository(checkout.path, join(scanCacheRoot, entry.repository.replace("/", "__")));
      measurements.push({ repository: entry.repository, ...measured });
      const status = measured.identical ? "identical" : "DRIFT";
      console.error(
        `${entry.repository}: cold ${measured.coldMs.toFixed(0)} ms, warm ${measured.warmMs.toFixed(0)} ms, ` +
          `${measured.speedup.toFixed(2)}×, ${measured.findings} findings (${status})`,
      );
    }
  } finally {
    await rm(scanCacheRoot, { recursive: true, force: true });
  }

  const totalCold = measurements.reduce((sum, row) => sum + row.coldMs, 0);
  const totalWarm = measurements.reduce((sum, row) => sum + row.warmMs, 0);
  const aggregateSpeedup = totalCold / Math.max(totalWarm, 0.001);
  const allIdentical = measurements.every((row) => row.identical);
  return {
    schemaVersion: "offing.scan-cache-speed.v1",
    repositories: measurements,
    aggregateSpeedup,
    allIdentical,
    withinBudget: allIdentical && aggregateSpeedup >= SCAN_CACHE_SPEEDUP_FLOOR,
  };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const corpus = await loadPublicCorpus();
  const filter = parseCorpusFilter(argv);
  const selection = selectCorpusEntries(corpus.repositories, filter, []);
  // Default to a small Node sample so a local proof stays short; pass --ecosystem / --repo to widen.
  const entries =
    filter.ecosystems.length > 0 || filter.repositories.length > 0
      ? selection.entries
      : selection.entries.filter((entry) => entry.ecosystem === "node").slice(0, 5);
  if (entries.length === 0) throw new Error("No corpus repositories selected.");

  const result = await runScanCacheSpeed(entries, { offline: argv.includes("--offline") });
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `Aggregate warm speedup ${result.aggregateSpeedup.toFixed(2)}× over ${result.repositories.length} repositories ` +
        `(floor ${SCAN_CACHE_SPEEDUP_FLOOR}×, identical=${result.allIdentical}) — ${result.withinBudget ? "PASSED" : "FAILED"}`,
    );
  }
  if (!result.withinBudget) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
