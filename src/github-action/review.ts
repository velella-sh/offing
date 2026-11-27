import { posix, resolve } from "node:path";

import { declaredDependencies, parsePackageManifest } from "../detectors/npm/manifest.js";
import { npmLockfiles, parseLockContents } from "../detectors/npm/lockfiles/index.js";
import { mergeLockData } from "../detectors/npm/lockfiles/shared.js";
import { loadPackageRules, matchPackageRules, matchedRuleFinding } from "../detectors/npm/rules.js";
import type { DiffResult } from "../diff.js";
import { git } from "../diff.js";
import type { Finding } from "../domain.js";
import { snippetSymbolFindings } from "../snippet-symbols.js";
import { languageFor, maximumFileBytes } from "../source-files.js";
import { changedLines, selectChangedAnnotations } from "./diff.js";

/** Resolve refs before passing the range to other Git commands. */
export function reviewRange(root: string, base: string, head: string): { base: string; head: string; range: string } {
  const commit = (ref: string) =>
    git(root, ["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"])
      .toString("utf8")
      .trim();
  const revisions = { base: commit(base), head: commit(head) };
  return { ...revisions, range: `${revisions.base}..${revisions.head}` };
}

const maximumLockfileBytes = 20_000_000;

/** Reads a bounded regular Git blob. Null means a present entry could not be inspected. */
function committedText(
  root: string,
  ref: string,
  path: string,
  maximumBytes = maximumFileBytes,
): string | null | undefined {
  const entry = git(root, ["--literal-pathspecs", "ls-tree", "-l", "-z", ref, "--", path]).toString();
  if (entry.length === 0) return undefined;
  const [, object, size] = /^100(?:644|755) blob ([0-9a-f]+) +(\d+)\t/u.exec(entry) ?? [];
  if (object === undefined || Number(size) > maximumBytes) return null;
  const bytes = git(root, ["cat-file", "blob", object]);
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

function readManifest(source: string | undefined): ReturnType<typeof parsePackageManifest> | undefined {
  if (source === undefined) return undefined;
  try {
    return parsePackageManifest(source);
  } catch {
    return undefined;
  }
}

function npmLock(root: string, head: string, directory: string) {
  const sources = npmLockfiles.map((lockfile) =>
    committedText(root, head, posix.join(directory, lockfile), maximumLockfileBytes),
  );
  if (sources.includes(null)) return undefined;
  return parseLockContents(sources.map((source) => source ?? undefined));
}

async function manifestFindings(
  root: string,
  refs: ReturnType<typeof reviewRange>,
  path: string,
  contents: string,
  beforePath: string,
) {
  const manifest = readManifest(contents);
  if (!manifest) return [];
  const beforeContents = committedText(root, refs.base, beforePath);
  if (beforeContents === null) return [];
  const before = declaredDependencies(readManifest(beforeContents) ?? {});
  const declared = declaredDependencies(manifest);
  const rules = (await loadPackageRules()).filter((rule) => {
    const dependency = declared.get(rule.package);
    return typeof dependency?.range === "string" && !before.has(rule.package);
  });
  if (rules.length === 0) return [];
  const directory = posix.dirname(path);
  const rootLock = npmLock(root, refs.head, ".");
  const ownLock = directory === "." ? rootLock : npmLock(root, refs.head, directory);
  if (!rootLock || !ownLock) return [];
  const lock = mergeLockData(rootLock, ownLock);
  const project = { ...lock, directory, manifestPath: resolve(root, path), contents, manifest };
  return matchPackageRules(project, rules).map((entry): Finding => {
    const finding = matchedRuleFinding(root, entry, new Map([[entry.rule.id, []]]), []);
    return { ...finding, detector: "npm", confidence: finding.confidence ?? "range" };
  });
}

function renamedPaths(root: string, range: string): Map<string, string> {
  const entries = git(root, [
    "diff",
    "--relative",
    "--diff-filter=R",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--name-status",
    "-z",
    range,
    "--",
  ])
    .toString("utf8")
    .split("\0");
  const paths = new Map<string, string>();
  for (let index = 1; index < entries.length; index += 3) {
    const before = entries[index];
    const after = entries[index + 1];
    if (before !== undefined && after !== undefined) paths.set(after, before);
  }
  return paths;
}

async function reviewPath(
  root: string,
  refs: ReturnType<typeof reviewRange>,
  path: string,
  beforePath: string,
): Promise<Finding[]> {
  const packageManifest = posix.basename(path) === "package.json";
  const language = languageFor(path);
  if (!packageManifest && language !== "javascript" && language !== "typescript" && language !== "python") return [];
  const contents = committedText(root, refs.head, path);
  if (typeof contents !== "string") return [];
  return packageManifest
    ? manifestFindings(root, refs, path, contents, beforePath)
    : snippetSymbolFindings(path, contents);
}

/** Supplements the ordinary diff with source symbols and direct npm additions on the lines under review. */
export async function reviewFindings(
  root: string,
  refs: ReturnType<typeof reviewRange>,
  introduced: DiffResult["introduced"],
): Promise<Finding[]> {
  const changed = changedLines(root, refs.range);
  const supplemental: Finding[] = [];
  const renames = [...changed.keys()].some((path) => posix.basename(path) === "package.json")
    ? renamedPaths(root, refs.range)
    : new Map<string, string>();
  for (const path of changed.keys())
    supplemental.push(...(await reviewPath(root, refs, path, renames.get(path) ?? path)));
  const key = ({ ruleId, location }: Finding) => JSON.stringify([ruleId, location.path, location.line]);
  const existing = new Set(introduced.map(key));
  return [
    ...introduced,
    ...selectChangedAnnotations(supplemental, changed).annotated.filter((finding) => !existing.has(key(finding))),
  ].sort((first, second) => first.id.localeCompare(second.id));
}
