import type { ForecastSkippedFile } from "../../forecast-tool-types.js";
import { isRecord } from "../references.js";
import { gitBlobSha, readBounded } from "./body.js";
import { parseGitHubForecastInput } from "./input.js";

const api = "https://api.github.com";
const raw = "https://raw.githubusercontent.com";
const maxTreeBytes = 8 * 1024 * 1024;
const maxFileBytes = 1024 * 1024;
const maxTotalBytes = 5 * 1024 * 1024;
const maxFiles = 40;
const maxSkippedPaths = 40;

export const repositoryNetworkNotice =
  "Offing requests the public repository tree from api.github.com and selected files from raw.githubusercontent.com. No repository contents or forecast results are sent to Velella.";
const manifest = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|requirements\.txt|pyproject\.toml)$/u;
const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
const sha1 = /^[a-f\d]{40}$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });
const request: RequestInit = { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" };

interface TreeFile {
  path: string;
  size: number;
  sha: string;
}

interface ForecastFile {
  path: string;
  contents: string;
}

function safePath(path: string): boolean {
  if (path.length > 4096 || /[\p{Cc}\p{Surrogate}\\]/u.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function asCandidate(entry: unknown): TreeFile | ForecastSkippedFile | undefined {
  if (!isRecord(entry)) return;
  const { path, size, sha, mode, type } = entry;
  if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return;
  if (typeof path !== "string" || !safePath(path) || !(manifest.test(path) || workflow.test(path))) return;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    typeof sha !== "string" ||
    !sha1.test(sha)
  ) {
    return { path, reason: "Invalid GitHub file metadata." };
  }
  return { path, size, sha };
}

function selectFiles(tree: unknown) {
  if (!isRecord(tree) || !Array.isArray(tree.tree) || typeof tree.truncated !== "boolean") {
    throw new Error("GitHub returned an invalid repository tree.");
  }
  if (tree.truncated) throw new Error("GitHub truncated the repository tree. Choose a smaller repository or ref.");
  const candidates = new Map<string, TreeFile | ForecastSkippedFile>();
  for (const entry of tree.tree) {
    const file = asCandidate(entry);
    if (!file) continue;
    if (candidates.has(file.path)) throw new Error("GitHub returned a duplicate repository path.");
    candidates.set(file.path, file);
  }

  const selected: TreeFile[] = [];
  const skipped: ForecastSkippedFile[] = [];
  let omitted = 0;
  let bytes = 0;
  const skip = (path: string, reason: string): void => {
    if (skipped.length < maxSkippedPaths) skipped.push({ path, reason });
    else omitted++;
  };
  for (const file of [...candidates.values()].sort((left, right) => (left.path < right.path ? -1 : 1))) {
    if ("reason" in file) skip(file.path, file.reason);
    else if (file.size > maxFileBytes) skip(file.path, "File exceeds 1 MiB.");
    else if (selected.length === maxFiles || bytes + file.size > maxTotalBytes) {
      skip(file.path, "Repository file count or byte limit reached.");
    } else {
      selected.push(file);
      bytes += file.size;
    }
  }
  return { selected, skipped, omitted };
}

async function secondaryLimit(response: Response): Promise<boolean> {
  try {
    const data = await readBounded(response, 4096, "GitHub error response");
    const error: unknown = JSON.parse(decoder.decode(data));
    return isRecord(error) && typeof error.message === "string" && /secondary rate limit/iu.test(error.message);
  } catch {
    return false;
  }
}

async function rateLimitError(response: Response): Promise<Error | undefined> {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  if (response.status !== 429) {
    if (response.status !== 403) return;
    if (remaining !== "0" && retryAfter === null && !(await secondaryLimit(response))) return;
  }
  const seconds = response.headers.get("x-ratelimit-reset");
  const resets = seconds && /^\d+$/u.test(seconds) ? new Date(Number(seconds) * 1000) : undefined;
  const reset = resets && Number.isFinite(resets.getTime()) ? resets.toISOString() : "unavailable";
  const count = remaining && /^\d+$/u.test(remaining) ? remaining : "unavailable";
  const retry = retryAfter && /^\d+$/u.test(retryAfter) ? ` Retry after ${retryAfter} seconds.` : "";
  return new Error(`GitHub rate limit reached. Remaining requests: ${count}. Reset time: ${reset}.${retry}`);
}

function responseError(status: number, subject?: string): Error {
  if (subject === undefined && status === 404) {
    return new Error("GitHub could not find a public repository or ref. Choose or paste private files locally.");
  }
  if (subject === undefined && status === 409) {
    return new Error("The GitHub repository is empty or unavailable. Choose a public repository with files.");
  }
  return new Error(`Could not fetch ${subject ?? "the repository tree"} from GitHub (HTTP ${status}).`);
}

async function get(fetchPublic: typeof fetch, url: string, signal?: AbortSignal, subject?: string): Promise<Response> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetchPublic(url, { ...request, ...(signal ? { signal } : {}) });
  } catch {
    signal?.throwIfAborted();
    throw new Error(`Could not fetch ${subject ?? "the repository tree"} from GitHub.`);
  }
  signal?.throwIfAborted();
  if (response.ok) return response;
  const error = (await rateLimitError(response)) ?? responseError(response.status, subject);
  await response.body?.cancel().catch(() => undefined);
  signal?.throwIfAborted();
  throw error;
}

async function readFile(
  fetchPublic: typeof fetch,
  repoAtRef: string,
  file: TreeFile,
  signal?: AbortSignal,
): Promise<ForecastFile | ForecastSkippedFile> {
  const path = file.path.split("/").map(encodeURIComponent).join("/");
  const response = await get(fetchPublic, `${raw}/${repoAtRef}/${path}`, signal, file.path);
  const bytes = await readBounded(response, file.size, file.path);
  signal?.throwIfAborted();
  if (bytes.byteLength !== file.size || (await gitBlobSha(bytes)) !== file.sha) {
    signal?.throwIfAborted();
    throw new Error(`GitHub file changed while reading ${file.path}. Retry or use a commit SHA.`);
  }
  signal?.throwIfAborted();
  try {
    return { path: file.path, contents: decoder.decode(bytes) };
  } catch {
    return { path: file.path, reason: "File is not UTF-8 text." };
  }
}

function parseTree(bytes: Uint8Array): unknown {
  try {
    const tree: unknown = JSON.parse(decoder.decode(bytes));
    return tree;
  } catch {
    throw new Error("GitHub returned an invalid repository tree.");
  }
}

/** Fetch only supported public files using the fetch supplied to the browser adapter after consent. */
export async function readGitHubForecastFiles(
  input: { kind: "url"; value: string },
  fetchPublic: typeof fetch,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const { owner, repo, ref } = parseGitHubForecastInput(input.value);
  const encodedRef = encodeURIComponent(ref);
  const url = `${api}/repos/${owner}/${repo}/git/trees/${encodedRef}?recursive=1`;
  const response = await get(fetchPublic, url, signal);
  const tree = parseTree(await readBounded(response, maxTreeBytes, "GitHub repository tree"));
  const files: ForecastFile[] = [];
  const { selected, skipped, omitted } = selectFiles(tree);
  for (const file of selected) {
    const read = await readFile(fetchPublic, `${owner}/${repo}/${encodedRef}`, file, signal);
    if ("reason" in read) skipped.push(read);
    else files.push(read);
  }
  signal?.throwIfAborted();
  return { files, skipped, omitted };
}
