import { resolve } from "node:path";

import { readOptional } from "../../read-optional.js";
import { parseBunLock } from "./bun-lock.js";
import { parsePackageLock } from "./package-lock.js";
import { parsePnpmLock } from "./pnpm-lock.js";
import { emptyLockData } from "./shared.js";
import type { LockData } from "./shared.js";
import { parseYarnLock } from "./yarn-lock.js";

export const npmLockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];

/** Parses the supported lockfiles in npmLockfiles order, including when obtained from a committed tree. */
export function parseLockContents(lockfiles: readonly (string | undefined)[]): LockData {
  const resolved: LockData = emptyLockData();
  if (lockfiles[0]) parsePackageLock(lockfiles[0], resolved);
  if (lockfiles[1]) parsePackageLock(lockfiles[1], resolved);
  if (lockfiles[2]) parsePnpmLock(lockfiles[2], resolved);
  if (lockfiles[3]) parseYarnLock(lockfiles[3], resolved);
  if (lockfiles[4]) parseBunLock(lockfiles[4], resolved);
  return resolved;
}

/** Reads every supported lockfile directly inside `root` and merges what each one resolves. */
export async function collectLockData(root: string): Promise<LockData> {
  return parseLockContents(await Promise.all(npmLockfiles.map((name) => readOptional(resolve(root, name)))));
}
