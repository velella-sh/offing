import { posix } from "node:path";

/** Lockfiles that update when the matching manifest in the same directory changes. */
const COMPANION_LOCKFILES: Readonly<Record<string, readonly string[]>> = {
  "Cargo.toml": ["Cargo.lock"],
  "go.mod": ["go.sum"],
  "package.json": ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"],
  "composer.json": ["composer.lock"],
  Gemfile: ["Gemfile.lock"],
};

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Byte-wise path order so scores stay identical across locales. */
export function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function companionLockfiles(manifestPath: string): string[] {
  const normalized = normalizePath(manifestPath);
  const companions = COMPANION_LOCKFILES[posix.basename(normalized)];
  if (companions === undefined) return [];
  const directory = posix.dirname(normalized);
  return companions.map((name) => (directory === "." ? name : posix.join(directory, name)));
}

/** Paths the agent may change without failing the unrelated-changes criterion. */
export function allowedChangePaths(input: {
  findingPath: string;
  checkPaths?: readonly string[];
  relatedPaths?: readonly string[];
}): string[] {
  const seeds = new Set<string>();
  for (const path of [input.findingPath, ...(input.checkPaths ?? []), ...(input.relatedPaths ?? [])]) {
    const normalized = normalizePath(path);
    if (normalized.length === 0) continue;
    seeds.add(normalized);
    for (const companion of companionLockfiles(normalized)) seeds.add(companion);
  }
  return [...seeds].sort(comparePaths);
}
