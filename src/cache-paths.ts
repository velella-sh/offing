import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where Offing keeps its caches on disk. This module imports only Node built-ins, so a command that must start
 * fast (`offing prompt`) can locate the scan cache without loading the data and signature code.
 */

/**
 * Offing's own cache directory (scan cache, usage log): `OFFING_DATA_DIR`, else the platform's cache directory.
 * Downloaded lifecycle data is Ebb's and lives in Ebb's cache directory instead.
 */
export function defaultCacheDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.OFFING_DATA_DIR) return env.OFFING_DATA_DIR;
  if (platform === "darwin") return join(home, "Library", "Caches", "offing");
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "offing", "Cache");
  return join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "offing");
}

/** Where per-file scan cache data lives: `OFFING_CACHE_DIR`, else `scan-cache` inside Offing's cache directory. */
export function defaultScanCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OFFING_CACHE_DIR) return env.OFFING_CACHE_DIR;
  return join(defaultCacheDirectory(env), "scan-cache");
}

const rootHash = (root: string): string => createHash("sha256").update(root).digest("hex");

/** The file holding the scan manifest of `root`. */
export function scanManifestFile(directory: string, root: string): string {
  return join(directory, "scans", `${rootHash(root)}.json`);
}

/** The directory holding one detector manifest per detector for `root`. */
export function detectorManifestDirectory(directory: string, root: string): string {
  return join(directory, "manifests", rootHash(root));
}

/** The file holding one detector's manifest for `root`. */
export function detectorManifestFile(directory: string, root: string, detectorId: string): string {
  return join(detectorManifestDirectory(directory, root), `${detectorId}.json`);
}
