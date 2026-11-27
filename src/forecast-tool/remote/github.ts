import { isRecord } from "../references.js";
import { gitBlobSha, readBounded } from "./body.js";
import { parseGitHubForecastInput } from "./input.js";

const api = "https://api.github.com";
const raw = "https://raw.githubusercontent.com";
const maxTreeBytes = 8 * 1024 * 1024;
const maxFileBytes = 1024 * 1024;
const maxTotalBytes = 5 * 1024 * 1024;
const maxFiles = 40;
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

function asFile(entry: unknown): TreeFile | undefined {
  if (!isRecord(entry)) return;
  const { path, size, sha, mode, type } = entry;
  if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return;
  if (typeof path !== "string" || !safePath(path) || !(manifest.test(path) || workflow.test(path))) return;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > maxFileBytes) return;
  if (typeof sha !== "string" || !sha1.test(sha)) return;
  return { path, size, sha };
}

function selectFiles(tree: unknown): TreeFile[] {
  if (!isRecord(tree) || !Array.isArray(tree.tree) || typeof tree.truncated !== "boolean") {
    throw new Error("GitHub returned an invalid repository tree.");
  }
  if (tree.truncated) throw new Error("GitHub truncated the repository tree. Choose a smaller repository or ref.");
  const candidates = new Map<string, TreeFile>();
  for (const entry of tree.tree) {
    const file = asFile(entry);
    if (!file) continue;
    if (candidates.has(file.path)) throw new Error("GitHub returned a duplicate repository path.");
    candidates.set(file.path, file);
  }

  const selected: TreeFile[] = [];
  let bytes = 0;
  for (const path of [...candidates.keys()].sort()) {
    const file = candidates.get(path);
    if (!file || bytes + file.size > maxTotalBytes) continue;
    selected.push(file);
    bytes += file.size;
    if (selected.length === maxFiles) break;
  }
  return selected;
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

async function get(fetchPublic: typeof fetch, url: string, subject: string, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetchPublic(url, { ...request, ...(signal ? { signal } : {}) });
  } catch {
    signal?.throwIfAborted();
    throw new Error(`Could not fetch ${subject} from GitHub.`);
  }
  signal?.throwIfAborted();
  if (response.ok) return response;
  const error =
    (await rateLimitError(response)) ?? new Error(`Could not fetch ${subject} from GitHub (HTTP ${response.status}).`);
  await response.body?.cancel().catch(() => undefined);
  signal?.throwIfAborted();
  throw error;
}

async function readFile(
  fetchPublic: typeof fetch,
  repoAtRef: string,
  file: TreeFile,
  signal?: AbortSignal,
): Promise<ForecastFile> {
  const path = file.path.split("/").map(encodeURIComponent).join("/");
  const response = await get(fetchPublic, `${raw}/${repoAtRef}/${path}`, file.path, signal);
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
    throw new Error(`GitHub file is not UTF-8 text: ${file.path}.`);
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
): Promise<ForecastFile[]> {
  signal?.throwIfAborted();
  const { owner, repo, ref } = parseGitHubForecastInput(input.value);
  const encodedRef = encodeURIComponent(ref);
  const url = `${api}/repos/${owner}/${repo}/git/trees/${encodedRef}?recursive=1`;
  const response = await get(fetchPublic, url, "the repository tree", signal);
  const tree = parseTree(await readBounded(response, maxTreeBytes, "GitHub repository tree"));
  const files: ForecastFile[] = [];
  for (const file of selectFiles(tree)) {
    files.push(await readFile(fetchPublic, `${owner}/${repo}/${encodedRef}`, file, signal));
  }
  signal?.throwIfAborted();
  return files;
}
