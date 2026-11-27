import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { bundledRules } from "@velella/ebb/bundled-rules";
import semver from "semver";

import { childEnvironments } from "./autopilot/limits/secrets.js";
import type { Finding, ScanResult } from "./domain.js";
import { planFixReport } from "./fix/index.js";
import { suggestionComment, suggestionsFromPatch } from "./github-action/diff.js";
import { committedText } from "./github-action/review.js";
import type { LineRange, SuggestionComment } from "./github-action/types.js";
import { createMigrationPacket } from "./migration-packet.js";
import { readPinnedRuntimes } from "./runtime-pin.js";
import { maximumFileBytes } from "./source-files.js";
import { MISE_FILES } from "./version-files/mise.js";

const pinFiles = [".nvmrc", ".node-version", ".python-version", ".tool-versions", ...MISE_FILES];
const noSuggestion = "No deterministic codemod suggestion is available on these lines.";
const snapshotFileLimit = 250;
const snapshotByteLimit = 20 * maximumFileBytes;
const credentialName =
  /(?:^|[_-])(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|credentials?)(?:$|[_-])/iu;
const credentialAssignment =
  /\b[\w.-]*(?:token|secret|password|passwd|api[_-]?key|auth)[\w.-]*["']?\s*[:=]\s*["']?[^\s"',]+/iu;
const urlUserInfo = /\b[a-z][a-z\d+.-]*:\/\/[^\s/@]+@/iu;

type ContainsPrivateText = (text: string) => boolean;

export function reviewPrivateText(env: Record<string, string | undefined>, root: string): ContainsPrivateText {
  const names = Object.keys(env).filter((name) => credentialName.test(name));
  const { containsSecret } = childEnvironments(env, "replay", names);
  return (text) =>
    containsSecret(text) ||
    credentialAssignment.test(text) ||
    urlUserInfo.test(text) ||
    (root.length > 1 && text.includes(root));
}

export interface ReviewEntry {
  finding: Finding;
  comment: SuggestionComment;
}

export interface ReviewDetails {
  comments: SuggestionComment[];
  packetDirectory?: string;
}

function portablePath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !/[:\\]/u.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function* findingPaths(finding: Finding): IterableIterator<string> {
  yield finding.location.path;
  for (const { location } of finding.usages ?? []) yield location.path;
}

function snapshotPaths(entries: readonly ReviewEntry[]): Set<string> | undefined {
  const paths = new Set(pinFiles);
  for (const { finding } of entries) {
    for (const path of findingPaths(finding)) {
      if (!portablePath(path)) continue;
      paths.add(path);
      if (paths.size > snapshotFileLimit) return undefined;
    }
  }
  return paths;
}

async function copyHeadFiles(
  root: string,
  head: string,
  destination: string,
  paths: ReadonlySet<string>,
): Promise<boolean> {
  let bytes = 0;
  for (const path of paths) {
    const source = committedText(root, head, path);
    if (typeof source !== "string") continue;
    bytes += Buffer.byteLength(source);
    if (bytes > snapshotByteLimit) return false;
    const file = join(destination, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source, { flag: "wx" });
  }
  return true;
}

async function deterministicSuggestion(
  result: ScanResult,
  finding: Finding,
  comment: SuggestionComment,
  changed: readonly LineRange[],
  isPrivate: ContainsPrivateText,
): Promise<SuggestionComment> {
  const fallback = { ...comment, body: `${comment.body}\n\n${noSuggestion}` };
  try {
    const { patches, refusals } = await planFixReport({ ...result, findings: [finding] });
    const [patch] = patches;
    if (patches.length !== 1 || !patch || patch.path !== finding.location.path || refusals.length > 0) return fallback;
    const [suggestion, other] = suggestionsFromPatch(patch.path, patch.diff, true);
    if (
      !suggestion ||
      other ||
      suggestion.replacement.some((line) => line.trimStart().startsWith("```") || isPrivate(line))
    ) {
      return fallback;
    }
    const { startLine, line } = suggestion;
    if (comment.line < startLine || comment.line > line) return fallback;
    if (!changed.some((range) => startLine >= range.start && line <= range.end)) return fallback;
    const inline = suggestionComment(suggestion);
    return { ...inline, path: comment.path, body: `${comment.body}\n\n${inline.body}` };
  } catch {
    return fallback;
  }
}

function artifactLink(env: Record<string, string | undefined>): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = env;
  if (!server || !repository || !runId || !/^\d+$/u.test(runId) || !URL.canParse(server)) return undefined;
  const url = new URL(server);
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  return `${url.origin}/${repository}/actions/runs/${runId}#artifacts`;
}

async function packetWriter(
  result: ScanResult,
  env: Record<string, string | undefined>,
  isPrivate: ContainsPrivateText,
) {
  const link = artifactLink(env);
  if (!link) return undefined;
  const rules = await bundledRules();
  const rawPins = await readPinnedRuntimes(result.root);
  const node = rawPins.node ? semver.coerce(rawPins.node)?.version : undefined;
  const python = rawPins.python ? semver.coerce(rawPins.python)?.version : undefined;
  const pins = { ...(node ? { node } : {}), ...(python ? { python } : {}) };
  const directory = await mkdtemp(join(env.RUNNER_TEMP ?? tmpdir(), "offing-agent-packets-"));
  const attempt = /^\d+$/u.test(env.GITHUB_RUN_ATTEMPT ?? "") ? env.GITHUB_RUN_ATTEMPT : "1";
  const write = async (finding: Finding): Promise<string> => {
    if (!Array.from(findingPaths(finding)).every(portablePath))
      throw new Error("Non-relative path in migration packet.");
    const usages = finding.usages?.map((usage) => ({ ...usage, excerpt: "" }));
    const sanitizedFinding = { ...finding, ...(usages ? { usages } : {}) };
    const packet = createMigrationPacket(
      { ...result, root: ".", findings: [sanitizedFinding] },
      finding.id,
      rules,
      pins,
    );
    const json = JSON.stringify(
      packet,
      (_key, value: unknown) => {
        if (typeof value === "string" && isPrivate(value)) throw new Error("Private text in migration packet.");
        return value;
      },
      2,
    );
    const hash = createHash("sha256").update(finding.id).digest("hex").slice(0, 16);
    const filename = `migration-${hash}.json`;
    await writeFile(join(directory, filename), json + "\n");
    return `**Ask your agent to fix this.** Give it \`${filename}\` from [offing-agent-migration-packets-${attempt}](<${link}>).`;
  };
  return { directory, write };
}

/** Plan against regular files from the reviewed head. Never read a checkout's local changes or follow symlinks. */
export async function addReviewDetails(
  result: ScanResult,
  head: string,
  entries: readonly ReviewEntry[],
  changed: ReadonlyMap<string, readonly LineRange[]>,
  env: Record<string, string | undefined>,
  isPrivate: ContainsPrivateText,
): Promise<ReviewDetails> {
  const paths = snapshotPaths(entries);
  const fallback = () => ({
    comments: entries.map(({ comment }) => ({ ...comment, body: `${comment.body}\n\n${noSuggestion}` })),
  });
  if (!paths) return fallback();
  const snapshot = await mkdtemp(join(tmpdir(), "offing-review-head-"));
  try {
    if (!(await copyHeadFiles(result.root, head, snapshot, paths).catch(() => false))) return fallback();
    const committedResult = { ...result, root: snapshot };
    const packets = await packetWriter(committedResult, env, isPrivate).catch(() => undefined);
    const comments: SuggestionComment[] = [];
    let wrotePackets = false;
    for (const { finding, comment } of entries) {
      const inline = await deterministicSuggestion(
        committedResult,
        finding,
        comment,
        changed.get(finding.location.path) ?? [],
        isPrivate,
      );
      const packet = await packets?.write(finding).catch(() => undefined);
      if (packet) wrotePackets = true;
      comments.push({ ...inline, body: packet ? `${inline.body}\n\n${packet}` : inline.body });
    }
    if (packets && wrotePackets) return { comments, packetDirectory: packets.directory };
    if (packets) await rm(packets.directory, { recursive: true, force: true });
    return { comments };
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}
