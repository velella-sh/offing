import { builtInDetectors } from "./detectors/index.js";
import { diffRefs, scanRef } from "./diff.js";
import type { DiffResult } from "./diff.js";
import type { Finding, ScanResult } from "./domain.js";
import { cachedRepositoryFindings, scanDetectorSignatures, scanRepository } from "./engine/index.js";
import type { ScanOptions } from "./engine/index.js";
import type { ScanCache } from "./scan-cache.js";

/** Scans with the built-in detectors so adapters never import the detectors package. */
export function scanWithBuiltIns(root: string, options?: ScanOptions): Promise<ScanResult> {
  return scanRepository(root, builtInDetectors, options);
}

/** Diffs two refs with the built-in detectors so adapters never import the detectors package. */
export function diffWithBuiltIns(root: string, range: string): Promise<DiffResult> {
  return diffRefs(root, range, builtInDetectors);
}

/** Scans a Git tree with the built-in detectors without changing the checkout. */
export function scanRefWithBuiltIns(root: string, ref: string): Promise<Finding[]> {
  return scanRef(root, ref, builtInDetectors);
}

export function builtInScanSignatures(dataVersion: string): Record<string, string> {
  return scanDetectorSignatures(builtInDetectors, dataVersion);
}

export function cachedBuiltInFindings(root: string, cache: ScanCache, scannedAt: string, dataVersion: string) {
  return cachedRepositoryFindings(root, builtInDetectors, cache, scannedAt, dataVersion);
}
