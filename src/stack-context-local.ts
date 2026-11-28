import { resolve } from "node:path";

import { BUNDLED_ECOSYSTEMS, loadEcosystem } from "@velella/ebb/data/load";
import { getActiveData } from "@velella/ebb/data-source";
import { dataInfoFrom } from "@velella/ebb/data-status";
import { isDeepStrictEqual } from "node:util";

import { ScanCache } from "./scan-cache.js";
import { builtInScanSignatures, cachedBuiltInFindings, scanWithBuiltIns } from "./scan-builtins.js";
import { analyzeSourceUsage } from "./source-usage.js";
import { buildStackContext, stackApiContracts, type StackContext } from "./stack-context.js";
import { readRuntimePins } from "./upgrade/target-lifecycle.js";

async function readCachedFindings(root: string, scannedAt: string, version: string) {
  if (process.env.OFFING_NO_CACHE === "1") return undefined;
  const cache = new ScanCache();
  const manifest = await cache.getScanManifest(root);
  if (
    typeof manifest?.scannedAt !== "string" ||
    !manifest.scannedAt.startsWith(scannedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(manifest.scannedAt)) ||
    manifest.scannedAt > scannedAt ||
    !isDeepStrictEqual(manifest.detectorSignatures, builtInScanSignatures(version))
  ) {
    return undefined;
  }
  return cachedBuiltInFindings(root, cache, scannedAt, version);
}

export async function readStackContext(path: string, mode: "cached"): Promise<StackContext | undefined>;
export async function readStackContext(path: string, mode?: "scan", scannedAt?: string): Promise<StackContext>;
export async function readStackContext(
  path: string,
  mode: "cached" | "scan" = "scan",
  pinnedScanTime?: string,
): Promise<StackContext | undefined> {
  const root = resolve(path);
  const scannedAt = pinnedScanTime ?? new Date().toISOString();
  const active = await getActiveData();
  const cached = pinnedScanTime ? undefined : await readCachedFindings(root, scannedAt, active.info.version);
  if (mode === "cached" && cached === undefined) return undefined;

  const [findings, registries, pins] = await Promise.all([
    cached ?? scanWithBuiltIns(root, { noCache: true, scannedAt }).then(({ findings }) => findings),
    Promise.all(BUNDLED_ECOSYSTEMS.map(loadEcosystem)),
    readRuntimePins(root, { markAmbiguous: true }),
  ]);
  const rules = registries.flat();
  const contracts = stackApiContracts(rules, pins, scannedAt.slice(0, 10));
  const usages = contracts.length === 0 ? [] : await analyzeSourceUsage(root, contracts);
  const observed = new Set(usages.filter(({ usages }) => usages.length > 0).map(({ contractId }) => contractId));
  return buildStackContext(
    { findings, scannedAt, data: dataInfoFrom(active, new Date(scannedAt)) },
    rules,
    pins,
    observed,
  );
}
