// The scan pipeline: discover → detect → resolve → report. This entry point owns the timestamp, the
// active data version, the cache, and the orchestration; each stage owns its own module and tests.

import { join, resolve } from "node:path";

import { getActiveData } from "@velella/ebb/data-source";
import { dataInfoFrom } from "@velella/ebb/data-status";
import { staleDataWarning } from "../data-text.js";
import type { DataInfo, Finding, ScanResult, UnclassifiedReference } from "../domain.js";
import type { ScanFileSystem } from "../file-system.js";
import { nodeFileSystem } from "../node-file-system.js";
import { advisoryIdsByRuleId } from "../osv-advisories.js";
import { computeFileHash, defaultScanCacheDirectory, ScanCache } from "../scan-cache.js";
import type { Detector } from "../sdk.js";
import { detectAll, detectorVersion, readCurrentDetections } from "./detect.js";
import type { DetectorResult } from "./detect.js";
import { listRepositoryFiles } from "./discover.js";
import { buildScanResult } from "./report.js";
import type { MultiScanResult } from "./report.js";
import { sortFindings, sortReferences, withAdvisories } from "./resolve.js";

export { CROSS_FILE_DETECTORS, defaultConfidence, shouldDisableCacheForDetector } from "./detect.js";
export { buildScanCoverage, findRepositories } from "./discover.js";
export { renderMultiScanText } from "./report.js";
export type { MultiScanResult } from "./report.js";
export { applyScanSelection, scanSelectorMatches } from "./resolve.js";

export interface ScanOptions {
  /**
   * When true, skips reading from or writing to the cache, forcing all detectors to scan fresh.
   */
  readonly noCache?: boolean;
  /** Directory for scan cache entries; defaults to `OFFING_CACHE_DIR` or the platform cache directory. */
  readonly cacheDirectory?: string;
  /** Where the scan reads files from. Defaults to the real filesystem. */
  readonly fileSystem?: ScanFileSystem;
  /** Custom scan cache instance. */
  readonly cache?: ScanCache;
  /** Specific scannedAt ISO timestamp to use (keeps scans deterministic in tests). */
  readonly scannedAt?: string;
  /** Data version override (useful for testing cache invalidation on data update). */
  readonly dataVersion?: string;
}

/** The file system and cache a scan uses: the ones in `options`, or the real file system and its default cache. */
function scanSetup(options: ScanOptions): { fileSystem: ScanFileSystem; scanCache: ScanCache } {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const scanCache = options.cache ?? new ScanCache(options.cacheDirectory ?? defaultScanCacheDirectory(), fileSystem);
  return { fileSystem, scanCache };
}

/** Hashes kept between detectors: enough to reuse the same file across detectors, bounded so a huge tree cannot grow the cache. */
const fileHashCacheEntries = 4096;

/**
 * Reads each file at most once per scan and remembers its content hash in a bounded cache.
 *
 * Every detector asks for the hash of each of its input files. Keeping the last few thousand hashes
 * reuses the work when detectors overlap, while evicting the oldest entry keeps the cache a fixed
 * size instead of one promise per file in the repository.
 */
export function fileHashReader(root: string, fileSystem: ScanFileSystem): (relPath: string) => Promise<string> {
  const hashes = new Map<string, Promise<string>>();
  return (relPath) => {
    const existing = hashes.get(relPath);
    if (existing !== undefined) {
      // Refresh recency: a hash another detector will ask for again stays in the cache.
      hashes.delete(relPath);
      hashes.set(relPath, existing);
      return existing;
    }
    const pending = (async () => {
      try {
        return computeFileHash(await fileSystem.readBytes(join(root, relPath)));
      } catch {
        return "";
      }
    })();
    hashes.set(relPath, pending);
    while (hashes.size > fileHashCacheEntries) {
      const oldest = hashes.keys().next().value;
      if (oldest === undefined) break;
      hashes.delete(oldest);
    }
    return pending;
  };
}

/** Downloaded data, its warnings, and the version to key cache entries by. */
interface ActiveScanData {
  readonly data?: DataInfo;
  readonly warnings: string[];
  readonly version: string;
}

/** Loads the active lifecycle data, or nothing when no detectors run. */
async function activeScanData(detectors: readonly Detector[], scannedAt: Date): Promise<ActiveScanData> {
  const active = detectors.length === 0 ? undefined : await getActiveData();
  const data = active ? dataInfoFrom(active, scannedAt) : undefined;
  return {
    ...(data ? { data } : {}),
    warnings: active ? [...active.info.warnings, ...(data?.stale ? [staleDataWarning(data)] : [])] : [],
    version: active?.info.version ?? "bundled",
  };
}

/** Records which detector and data versions produced this scan, for cache diagnostics. */
async function recordScanManifest(
  scanCache: ScanCache,
  root: string,
  scannedAt: string,
  detectors: readonly Detector[],
  dataVersion: string,
): Promise<void> {
  await scanCache.setScanManifest({
    root,
    scannedAt,
    detectorSignatures: scanDetectorSignatures(detectors, dataVersion),
  });
}

/** Merges detector output into the deterministic findings and references a result carries. */
async function resolveAnalyses(
  detectors: readonly Detector[],
  analyses: readonly DetectorResult[],
): Promise<{ findings: Finding[]; references: UnclassifiedReference[] }> {
  const advisories = detectors.length === 0 ? new Map<string, string[]>() : await advisoryIdsByRuleId();
  return {
    findings: sortFindings(
      withAdvisories(
        analyses.flatMap((analysis) => analysis.findings),
        advisories,
      ),
    ),
    references: sortReferences(analyses.flatMap((analysis) => analysis.unclassified)),
  };
}

export function scanDetectorSignatures(detectors: readonly Detector[], dataVersion: string): Record<string, string> {
  return Object.fromEntries(detectors.map((detector) => [detector.id, `${detectorVersion(detector)}:${dataVersion}`]));
}

function scanWorkspace(root: string, options: ScanOptions) {
  const resolvedRoot = resolve(root);
  const { fileSystem, scanCache } = scanSetup(options);
  // One timestamp so date-sensitive detectors agree for the whole scan.
  const scannedAt = new Date(options.scannedAt ?? Date.now());
  return {
    context: { root: resolvedRoot, scannedAt: options.scannedAt ?? scannedAt.toISOString() },
    scannedAt,
    fileSystem,
    scanCache,
    noCache: options.noCache ?? process.env.OFFING_NO_CACHE === "1",
  };
}

async function analyzeRepository(
  workspace: ReturnType<typeof scanWorkspace>,
  detectors: readonly Detector[],
  dataVersion: string,
) {
  const { context, fileSystem, scanCache, noCache } = workspace;
  const { root, scannedAt } = context;
  const repoFiles =
    detectors.length > 0 ? await listRepositoryFiles(root, fileSystem, resolve(scanCache.directory)) : [];
  const analyses = await detectAll(detectors, {
    context,
    root,
    repoFiles,
    cache: scanCache,
    fileSystem,
    dataVersion,
    noCache,
    getFileHash: fileHashReader(root, fileSystem),
  });
  if (!noCache && detectors.length > 0) {
    await recordScanManifest(scanCache, root, scannedAt, detectors, dataVersion);
  }
  return { analyses, repoFiles };
}

/** Runs the same detectors and cache as a full scan for consumers that only need lifecycle findings. */
export async function scanRepositoryFindings(
  root: string,
  detectors: readonly Detector[],
): Promise<Pick<ScanResult, "findings">> {
  const active = await getActiveData();
  // The bundled resolver is lazy. Read a required registry even when the detector cache is warm.
  await active.read("registry/nodejs.json");
  const { analyses } = await analyzeRepository(scanWorkspace(root, {}), detectors, active.info.version);
  return { findings: sortFindings(analyses.flatMap((analysis) => analysis.findings)) };
}

export async function cachedRepositoryFindings(
  root: string,
  detectors: readonly Detector[],
  cache: ScanCache,
  scannedAt: string,
  dataVersion: string,
): Promise<Finding[] | undefined> {
  const analyses = await readCurrentDetections(detectors, {
    context: { root, scannedAt },
    root,
    repoFiles: await listRepositoryFiles(root, nodeFileSystem, resolve(cache.directory)),
    cache,
    fileSystem: nodeFileSystem,
    dataVersion,
    noCache: false,
    getFileHash: fileHashReader(root, nodeFileSystem),
  });
  return analyses && sortFindings(analyses.flatMap(({ findings }) => findings));
}

/** Runs the detectors over a repository and returns the sorted, deduplicated findings. */
export async function scanRepository(
  root: string,
  detectors: readonly Detector[] = [],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const workspace = scanWorkspace(root, options);
  // Say so when downloaded data was refused and the bundled data was used instead.
  const active = await activeScanData(detectors, workspace.scannedAt);
  const { analyses, repoFiles } = await analyzeRepository(workspace, detectors, options.dataVersion ?? active.version);

  const { findings, references } = await resolveAnalyses(detectors, analyses);
  return buildScanResult({
    root: workspace.context.root,
    scannedAt: workspace.context.scannedAt,
    detectors,
    findings,
    references,
    repoFiles,
    fileSystem: workspace.fileSystem,
    diagnostics: detectors.length === 0 ? ["No detectors are enabled."] : active.warnings,
    ...(active.data ? { data: active.data } : {}),
  });
}

/** Scans each path in turn; projects come back sorted by path so the output is deterministic. */
export async function scanProjects(
  paths: readonly string[],
  detectors: readonly Detector[] = [],
  options: ScanOptions = {},
): Promise<MultiScanResult> {
  const unique = [...new Set(paths.map((path) => resolve(path)))].sort((left, right) => left.localeCompare(right));
  const projects: MultiScanResult["projects"] = [];
  for (const path of unique) {
    const result = await scanRepository(path, detectors, options);
    projects.push({ path, findings: result.findings.length, result });
  }
  return {
    schemaVersion: "offing.multi-scan.v1",
    projects,
    total: { projects: projects.length, findings: projects.reduce((sum, project) => sum + project.findings, 0) },
  };
}
