// Stage 2 — detect: run each detector, consulting the scan cache so unchanged files are not parsed
// again, and attribute every finding to the detector that produced it.

import { join, resolve } from "node:path";
import { basename } from "node:path/posix";

import { declaresInput } from "../detector-inputs.js";
import type { Confidence, Finding, UnclassifiedReference } from "../domain.js";
import type { ScanFileSystem } from "../file-system.js";
import { computeFileHash } from "../scan-cache.js";
import type { DetectorFileDescriptor, DetectorManifest, ScanCache } from "../scan-cache.js";
import { assertDetectorCompatible } from "../sdk.js";
import type { Detector, DetectorAnalysis, DetectorContext, DetectorFinding } from "../sdk.js";
import { isSkippedScanDirectory, trimTrailingSlashes } from "./discover.js";

/** Lockfiles whose entries are resolved versions rather than declarations. */
const LOCKFILE_NAME =
  /(^|[-.])(lock|lockfile)(\.[a-z]+)?$|\.lock$|^(go\.sum|pubspec\.lock|packages\.lock\.json|gemfile\.lock|composer\.lock|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|npm-shrinkwrap\.json)$/i;

/**
 * Detectors whose findings depend on the relationship between multiple files (for example,
 * a package manifest and a lockfile, workspace manifests, or source usage across files).
 * These detectors cannot evaluate a changed file in isolation, so they invalidate and re-run
 * at the manifest level whenever any input file changes.
 */
export const CROSS_FILE_DETECTORS = new Set([
  "npm",
  "python",
  "go",
  "rust",
  "java",
  "dotnet",
  "php",
  "ruby",
  "swift",
  "dart",
  "scala",
  "elixir",
  "android",
  "cpp",
  "database",
]);

/**
 * Checks whether caching should be disabled for a detector.
 * A detector that omits `inputs` makes no promise about which files it reads, and a detector
 * that reads skipped directory trees (such as CLE reading `node_modules`) cannot be safely keyed
 * by normal repository file traversal without risking stale results.
 */
export function shouldDisableCacheForDetector(detector: Detector): boolean {
  if (!detector.inputs) return true;
  const dirs = detector.inputs.directories;
  if (dirs && dirs.some((d) => isSkippedScanDirectory(trimTrailingSlashes(d)))) {
    return true;
  }
  return false;
}

/** What a finding is worth when its detector did not say: a lockfile entry is inferred-from-lock, any other read is exact. */
export function defaultConfidence(finding: DetectorFinding): Confidence {
  return finding.confidence ?? (LOCKFILE_NAME.test(basename(finding.location.path)) ? "inferred-from-lock" : "exact");
}

/** A detector's output after the engine has attributed it to that detector. */
export interface DetectorResult {
  findings: Finding[];
  unclassified: UnclassifiedReference[];
}

/** The hash of a detector's code, so a code change invalidates its cached results. */
export function detectorCode(detector: Detector): string {
  return computeFileHash(detector.scan.toString() + (detector.analyze ? detector.analyze.toString() : ""));
}

/** The version the engine records for a detector: its declared version and a hash of its code. */
export function detectorVersion(detector: Detector): string {
  const version =
    "version" in detector && typeof detector.version === "string" ? detector.version : detector.apiVersion;
  return `${version}:${detectorCode(detector)}`;
}

/** Everything a detection pass needs beyond the detector list. */
export interface DetectOptions {
  readonly context: DetectorContext;
  readonly root: string;
  readonly repoFiles: readonly string[];
  readonly cache: ScanCache;
  readonly fileSystem: ScanFileSystem;
  readonly dataVersion: string;
  readonly noCache: boolean;
  readonly getFileHash: (relPath: string) => Promise<string>;
  /** Per-scan basename/extension index; built once in `detectAll` so warm hits skip O(files×detectors) filters. */
  readonly fileIndex?: RepoFileIndex;
}

/** Basename and extension lookup built once per scan from the repository file list. */
export interface RepoFileIndex {
  readonly byBaseName: ReadonlyMap<string, readonly string[]>;
  readonly byExtension: ReadonlyMap<string, readonly string[]>;
  readonly all: readonly string[];
}

/** Files hashed or looked up per batch: bounds the promises and cache entries in flight on a huge tree. */
const fileBatchSize = 256;

/** Builds basename and extension indexes so each detector can resolve its inputs without scanning every path. */
export function buildRepoFileIndex(repoFiles: readonly string[]): RepoFileIndex {
  const byBaseName = new Map<string, string[]>();
  const byExtension = new Map<string, string[]>();
  for (const path of repoFiles) {
    const normalized = path.split("\\").join("/");
    const base = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
    const bases = byBaseName.get(base);
    if (bases) bases.push(normalized);
    else byBaseName.set(base, [normalized]);
    const dot = base.lastIndexOf(".");
    if (dot <= 0) continue;
    const extension = base.slice(dot);
    const paths = byExtension.get(extension);
    if (paths) paths.push(normalized);
    else byExtension.set(extension, [normalized]);
  }
  return { byBaseName, byExtension, all: repoFiles };
}

/** Runs every detector; results come back in the order the detectors were given. */
export async function detectAll(detectors: readonly Detector[], options: DetectOptions): Promise<DetectorResult[]> {
  const withIndex = options.fileIndex ? options : { ...options, fileIndex: buildRepoFileIndex(options.repoFiles) };
  return Promise.all(detectors.map(async (detector) => detectOne(detector, withIndex)));
}

async function detectOne(detector: Detector, options: DetectOptions): Promise<DetectorResult> {
  assertDetectorCompatible(detector);
  if (options.noCache || shouldDisableCacheForDetector(detector)) {
    return analyzeDetector(detector, options.context);
  }
  const files = inputFiles(detector, options);
  if (detector.inputs !== undefined && files.length === 0) return { findings: [], unclassified: [] };
  const version = detectorVersion(detector);
  const manifest = await options.cache.getDetectorManifest(options.root, detector.id, version, options.dataVersion);
  // Warm path: size+mtime match the recorded fingerprints → reuse without reading file bytes.
  if (manifest !== undefined && (await fingerprintsMatch(manifest, files, options))) {
    return { findings: [...manifest.findings], unclassified: [...manifest.unclassified] };
  }
  const descriptors = await describeFiles(files, options);
  if (manifest !== undefined && contentHashesMatch(manifest, descriptors)) {
    return { findings: [...manifest.findings], unclassified: [...manifest.unclassified] };
  }
  return CROSS_FILE_DETECTORS.has(detector.id)
    ? detectAcrossFiles(detector, options, descriptors, version)
    : detectPerFile(detector, options, descriptors, version);
}

/** Adds paths whose basename matches a declared `fileNames` entry (exact or wildcard). */
function collectNamedInputs(names: readonly string[], index: RepoFileIndex, matched: Set<string>): void {
  for (const name of names) {
    if (name.includes("*")) {
      for (const path of index.all) {
        if (declaresInput({ fileNames: [name] }, path)) matched.add(path);
      }
      continue;
    }
    for (const path of index.byBaseName.get(name.toLowerCase()) ?? []) matched.add(path);
  }
}

/** Adds paths whose extension is in the detector's `extensions` or `sourceExtensions`. */
function collectExtensionInputs(extensions: readonly string[], index: RepoFileIndex, matched: Set<string>): void {
  for (const extension of extensions) {
    for (const path of index.byExtension.get(extension.toLowerCase()) ?? []) matched.add(path);
  }
}

/** Adds paths that lie under any declared detector directory. */
function collectDirectoryInputs(directories: readonly string[], index: RepoFileIndex, matched: Set<string>): void {
  for (const directory of directories) {
    for (const path of index.all) {
      if (declaresInput({ directories: [directory] }, path)) matched.add(path);
    }
  }
}

/** Adds every path matching `inputs` into `matched`, using the per-scan file index when possible. */
function collectInputPaths(inputs: NonNullable<Detector["inputs"]>, index: RepoFileIndex, matched: Set<string>): void {
  collectNamedInputs(inputs.fileNames ?? [], index, matched);
  collectExtensionInputs([...(inputs.extensions ?? []), ...(inputs.sourceExtensions ?? [])], index, matched);
  collectDirectoryInputs(inputs.directories ?? [], index, matched);
}

/** The detector's input files, sorted so cache keys stay deterministic. */
function inputFiles(detector: Detector, options: DetectOptions): string[] {
  const index = options.fileIndex ?? buildRepoFileIndex(options.repoFiles);
  if (detector.inputs === undefined) return [...index.all].sort((left, right) => left.localeCompare(right));
  const matched = new Set<string>();
  collectInputPaths(detector.inputs, index, matched);
  return [...matched].sort((left, right) => left.localeCompare(right));
}

/** Stats each input path: used for the warm-path fingerprint check before any content hash. */
async function describeFingerprints(
  files: readonly string[],
  options: DetectOptions,
): Promise<Array<{ path: string; size: number; mtimeMs: number } | undefined>> {
  const fingerprints: Array<{ path: string; size: number; mtimeMs: number } | undefined> = [];
  for (let start = 0; start < files.length; start += fileBatchSize) {
    const batch = files.slice(start, start + fileBatchSize);
    fingerprints.push(
      ...(await Promise.all(
        batch.map(async (path) => {
          try {
            const info = await options.fileSystem.stat(join(options.root, path));
            return { path, size: info.size, mtimeMs: info.mtimeMs };
          } catch {
            return undefined;
          }
        }),
      )),
    );
  }
  return fingerprints;
}

/** True when recorded size/mtime fingerprints still match the live tree (order and length included). */
export function fingerprintsEqual(
  recorded: readonly { path: string; size?: number; mtimeMs?: number }[],
  live: readonly ({ path: string; size: number; mtimeMs: number } | undefined)[],
): boolean {
  if (recorded.length !== live.length) return false;
  if (!recorded.every((file) => Number.isFinite(file.size) && Number.isFinite(file.mtimeMs))) return false;
  return recorded.every((file, index) => {
    const current = live[index];
    return (
      current !== undefined &&
      file.path === current.path &&
      file.size === current.size &&
      file.mtimeMs === current.mtimeMs
    );
  });
}

/** True when every recorded fingerprint still matches size and mtime (and nothing was added or removed). */
async function fingerprintsMatch(
  manifest: DetectorManifest,
  files: readonly string[],
  options: DetectOptions,
): Promise<boolean> {
  return fingerprintsEqual(manifest.files, await describeFingerprints(files, options));
}

/** Hashes and stats each input file so a later warm scan can skip the hash work. */
async function describeFiles(files: readonly string[], options: DetectOptions): Promise<DetectorFileDescriptor[]> {
  const descriptors: DetectorFileDescriptor[] = [];
  // Hash in batches: `Promise.all` over a 100k-file tree would allocate one promise per file at once.
  for (let start = 0; start < files.length; start += fileBatchSize) {
    const batch = files.slice(start, start + fileBatchSize);
    descriptors.push(
      ...(await Promise.all(
        batch.map(async (path) => {
          const [hash, info] = await Promise.all([
            options.getFileHash(path),
            options.fileSystem.stat(join(options.root, path)).catch(() => ({ size: -1, mtimeMs: -1 })),
          ]);
          return { path, hash, size: info.size, mtimeMs: info.mtimeMs };
        }),
      )),
    );
  }
  return descriptors;
}

/** True when every recorded content hash still matches (fallback when mtime moved without a content change). */
export function contentHashesEqual(
  recorded: readonly { path: string; hash: string }[],
  live: readonly { path: string; hash: string }[],
): boolean {
  return (
    recorded.length === live.length &&
    recorded.every((file, index) => {
      const current = live[index];
      return current !== undefined && file.path === current.path && file.hash === current.hash;
    })
  );
}

function contentHashesMatch(manifest: DetectorManifest, descriptors: readonly DetectorFileDescriptor[]): boolean {
  return contentHashesEqual(manifest.files, descriptors);
}

/** Runs a detector (analyze when present, scan otherwise) and attributes its output to it. */
async function analyzeDetector(detector: Detector, context: DetectorContext): Promise<DetectorResult> {
  const analysis = detector.analyze
    ? await detector.analyze(context)
    : { findings: await detector.scan(context), unclassified: [] };
  return attribute(detector, analysis);
}

function attribute(detector: Detector, analysis: DetectorAnalysis): DetectorResult {
  return {
    findings: analysis.findings.map((finding) => ({
      ...finding,
      detector: detector.id,
      confidence: defaultConfidence(finding),
    })),
    unclassified: analysis.unclassified.map((reference) => ({
      ...reference,
      detector: detector.id,
    })),
  };
}

async function detectAcrossFiles(
  detector: Detector,
  options: DetectOptions,
  descriptors: readonly DetectorFileDescriptor[],
  version: string,
): Promise<DetectorResult> {
  const result = await analyzeDetector(detector, options.context);
  await cacheFiles(detector, options, version, descriptors, result);
  await options.cache.setDetectorManifest(options.root, {
    detectorId: detector.id,
    detectorVersion: version,
    dataVersion: options.dataVersion,
    files: [...descriptors],
    findings: result.findings,
    unclassified: result.unclassified,
  });
  return result;
}

/** File-isolated detectors reuse per-file cache entries and re-parse only the files that changed. */
async function detectPerFile(
  detector: Detector,
  options: DetectOptions,
  descriptors: readonly DetectorFileDescriptor[],
  version: string,
): Promise<DetectorResult> {
  const { cached, changed } = await readCachedFiles(detector, options, version, descriptors);
  if (changed.length === 0) return cached;
  const fresh =
    changed.length === descriptors.length
      ? await analyzeDetector(detector, options.context)
      : await analyzeSubset(detector, options, changed);
  await cacheFiles(detector, options, version, changed, fresh);
  const result = mergeResults(cached, fresh);
  await options.cache.setDetectorManifest(options.root, {
    detectorId: detector.id,
    detectorVersion: version,
    dataVersion: options.dataVersion,
    files: [...descriptors],
    findings: result.findings,
    unclassified: result.unclassified,
  });
  return result;
}

async function readCachedFiles(
  detector: Detector,
  options: DetectOptions,
  version: string,
  descriptors: readonly DetectorFileDescriptor[],
): Promise<{ cached: DetectorResult; changed: DetectorFileDescriptor[] }> {
  const cached: DetectorResult = { findings: [], unclassified: [] };
  const changed: DetectorFileDescriptor[] = [];
  // Read in batches for the same reason: one cache lookup per file at once is a large temporary array.
  for (let start = 0; start < descriptors.length; start += fileBatchSize) {
    const batch = descriptors.slice(start, start + fileBatchSize);
    const entries = await Promise.all(
      batch.map(async (descriptor) => ({
        descriptor,
        entry: await options.cache.get({
          filePath: descriptor.path,
          fileHash: descriptor.hash,
          detectorId: detector.id,
          detectorVersion: version,
          dataVersion: options.dataVersion,
        }),
      })),
    );
    for (const { descriptor, entry } of entries) {
      if (!entry) {
        changed.push(descriptor);
        continue;
      }
      cached.findings.push(...entry.findings);
      cached.unclassified.push(...entry.unclassified);
    }
  }
  return { cached, changed };
}

/** Copies only the changed files to a temporary root and re-parses the detector there. */
async function analyzeSubset(
  detector: Detector,
  options: DetectOptions,
  changed: readonly DetectorFileDescriptor[],
): Promise<DetectorResult> {
  const tempRoot = await options.fileSystem.makeTemporaryDirectory("offing-scan-");
  try {
    for (const descriptor of changed) {
      await options.fileSystem.copy(resolve(options.root, descriptor.path), join(tempRoot, descriptor.path));
    }
    const scannedAt = options.context.scannedAt;
    return await analyzeDetector(
      detector,
      scannedAt === undefined ? { root: tempRoot } : { root: tempRoot, scannedAt },
    );
  } finally {
    await options.fileSystem.remove(tempRoot).catch(() => undefined);
  }
}

/** Stores one cache entry per file, holding only the findings that point into that file. */
async function cacheFiles(
  detector: Detector,
  options: DetectOptions,
  version: string,
  descriptors: readonly DetectorFileDescriptor[],
  result: DetectorResult,
): Promise<void> {
  for (const descriptor of descriptors) {
    await options.cache.set({
      filePath: descriptor.path,
      fileHash: descriptor.hash,
      detectorId: detector.id,
      detectorVersion: version,
      dataVersion: options.dataVersion,
      findings: result.findings.filter((finding) => finding.location.path === descriptor.path),
      unclassified: result.unclassified.filter((reference) => reference.location.path === descriptor.path),
    });
  }
}

function mergeResults(first: DetectorResult, second: DetectorResult): DetectorResult {
  return {
    findings: [...first.findings, ...second.findings],
    unclassified: [...first.unclassified, ...second.unclassified],
  };
}
