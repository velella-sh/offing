import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { fetchArchiveTree } from "./archive.js";
import { fetchSparseTree, isMissingGit } from "./git.js";
import { FleetHostError, type FleetHost, type FleetRepository, type FleetSelection } from "./host.js";
import { fleetClient, fleetJson } from "./http.js";

const SIMPLE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const GITHUB_API = "https://api.github.com/";
const GITHUB_ORIGIN = "https://github.com/";
const execute = promisify(execFile);

export function validRepositoryPath(path: string): boolean {
  return path.split("/").every((segment) => SIMPLE_SEGMENT.test(segment) && !segment.endsWith("."));
}

export function validCommit(commit: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit);
}

export async function githubFleetToken(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (token) return token;
  const result = await execute("gh", ["auth", "token", "--hostname", "github.com"], {
    timeout: 5000,
    maxBuffer: 16_384,
    windowsHide: true,
  }).catch(() => undefined);
  return result?.stdout.trim() || undefined;
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Self-managed GitLab can live under a path prefix. HTTP is allowed for loopback fixtures only. */
export function gitlabBase(value: string): URL {
  const url = parseUrl(value);
  const loopback = url !== null && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new FleetHostError("GitLab needs an HTTPS origin (HTTP is supported for loopback fixtures).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new FleetHostError("GitLab URL must not contain credentials, query parameters or a fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new FleetHostError("Fleet host returned an invalid record.");
  return value;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function repository(value: unknown, gitlab: boolean): FleetRepository {
  const row = object(value);
  const name = gitlab ? row.path_with_namespace : row.full_name;
  if (typeof name !== "string" || !validRepositoryPath(name)) {
    throw new FleetHostError("Fleet host returned an invalid repository name.");
  }
  return {
    name,
    defaultBranch: typeof row.default_branch === "string" && row.default_branch ? row.default_branch : null,
    archived: row.archived === true,
    disabled: row.disabled === true || row.pending_delete === true,
    fork: gitlab ? row.forked_from_project != null : row.fork === true,
    topics: strings(row.topics ?? row.tag_list),
  };
}

interface RemoteOptions {
  readonly api?: string;
  readonly origin?: string;
  readonly request?: typeof fetch;
  readonly wait?: (ms: number) => Promise<unknown>;
}

function batchPath(namespace: string, page: number, gitlab: boolean): string {
  const encoded = encodeURIComponent(namespace);
  return gitlab
    ? `groups/${encoded}/projects?include_subgroups=true&with_shared=false&per_page=100&page=${page}`
    : `orgs/${encoded}/repos?type=all&per_page=100&page=${page}`;
}

function hasNext(response: Response, page: number): boolean {
  const next = response.headers.get("x-next-page");
  return next === String(page + 1) || /\brel="?next"?\b/u.test(response.headers.get("link") ?? "");
}

function branchPath(repo: FleetRepository, gitlab: boolean): string {
  const branch = encodeURIComponent(repo.defaultBranch ?? "HEAD");
  return gitlab
    ? `projects/${encodeURIComponent(repo.name)}/repository/branches/${branch}`
    : `repos/${repo.name}/branches/${branch}`;
}

function archivePath(repo: FleetRepository, commit: string, gitlab: boolean): string {
  return gitlab
    ? `projects/${encodeURIComponent(repo.name)}/repository/archive.tar.gz?sha=${commit}`
    : `repos/${repo.name}/tarball/${commit}`;
}

function credentials(token: string | undefined, gitlab: boolean): string | undefined {
  return token === undefined
    ? undefined
    : Buffer.from(`${gitlab ? "oauth2" : "x-access-token"}:${token}`).toString("base64");
}

interface FleetTransport {
  readonly api: URL;
  readonly base: URL;
  readonly gitlab: boolean;
  readonly request: ReturnType<typeof fleetClient>;
  readonly archiveRequest: ReturnType<typeof fleetClient>;
  readonly credential: string | undefined;
}

async function listRepositories(transport: FleetTransport, namespace: string): Promise<FleetRepository[]> {
  if (!validRepositoryPath(namespace) || (!transport.gitlab && namespace.includes("/"))) {
    throw new FleetHostError("Provide a GitHub organization or a GitLab group path.");
  }
  const selected = new Map<string, FleetRepository>();
  for (let page = 1; page <= 1000; page++) {
    const response = await transport.request(new URL(batchPath(namespace, page, transport.gitlab), transport.api));
    const body = await fleetJson(response);
    if (!Array.isArray(body)) throw new FleetHostError("Fleet host did not return an array of repositories.");
    for (const entry of body) {
      const repo = repository(entry, transport.gitlab);
      if (repo.name.toLowerCase().startsWith(`${namespace.toLowerCase()}/`)) selected.set(repo.name, repo);
    }
    if (!hasNext(response, page)) return [...selected.values()];
  }
  throw new FleetHostError("Fleet repository listing exceeded the pagination limit.");
}

async function branchHead(transport: FleetTransport, repo: FleetRepository): Promise<string> {
  const path = new URL(branchPath(repo, transport.gitlab), transport.api);
  const branch = object(await fleetJson(await transport.request(path)));
  const value = object(branch.commit);
  const commit = transport.gitlab ? value.id : value.sha;
  if (typeof commit !== "string" || !validCommit(commit)) throw new FleetHostError("Invalid fleet commit SHA.");
  return commit;
}

async function fetchPinned(
  transport: FleetTransport,
  repo: FleetRepository,
  commit: string,
  directory: string,
  selection: FleetSelection,
): Promise<number> {
  if (!validRepositoryPath(repo.name) || !validCommit(commit)) {
    throw new FleetHostError("Invalid fleet repository or commit SHA.");
  }
  const clone = new URL(`${repo.name}.git`, transport.base);
  try {
    return await fetchSparseTree(clone, commit, directory, selection, transport.credential);
  } catch (error) {
    if (!isMissingGit(error)) throw error;
  }
  const path = new URL(archivePath(repo, commit, transport.gitlab), transport.api);
  const response = await transport.request(path, "manual");
  if (response.ok) return fetchArchiveTree(response, directory, selection);
  const destination = parseUrl(response.headers.get("location") ?? "");
  await response.body?.cancel();
  // GitHub sends a signed codeload URL. Never forward API credentials to the redirect.
  if (
    transport.gitlab ||
    !destination ||
    destination.origin !== "https://codeload.github.com" ||
    destination.username ||
    destination.password
  ) {
    throw new FleetHostError("Fleet archive redirect left the allowed download origin.");
  }
  return fetchArchiveTree(await transport.archiveRequest(destination), directory, selection);
}

function remoteFleetHost(
  api: URL,
  base: URL,
  gitlab: boolean,
  token: string | undefined,
  options: RemoteOptions,
): FleetHost {
  if (token && !/^[!-~]+$/u.test(token)) {
    throw new FleetHostError("Fleet token must contain visible ASCII characters only.");
  }
  const authentication = token ? (gitlab ? { "PRIVATE-TOKEN": token } : { Authorization: `Bearer ${token}` }) : {};
  const headers = new Headers(authentication);
  headers.set("accept", gitlab ? "application/json" : "application/vnd.github+json");
  const denied = gitlab
    ? "GitLab denied access. Set GITLAB_TOKEN with read_api and read_repository access."
    : "GitHub denied access. Use GITHUB_TOKEN, GH_TOKEN or gh auth login with repository Metadata and Contents read access.";
  const transport = {
    api,
    base,
    gitlab,
    credential: credentials(token, gitlab),
    request: fleetClient(Object.fromEntries(headers), denied, options),
    archiveRequest: fleetClient({}, denied, options),
  };
  return {
    origin: base.href.replace(/\/$/u, ""),
    listRepositories: (namespace) => listRepositories(transport, namespace),
    readDefaultBranchHead: (repo) => branchHead(transport, repo),
    fetchFilesAtCommit: (repo, commit, directory, selection) =>
      fetchPinned(transport, repo, commit, directory, selection),
  };
}

export function githubFleetHost(token?: string, options: RemoteOptions = {}): FleetHost {
  return remoteFleetHost(
    new URL(options.api ?? GITHUB_API),
    new URL(options.origin ?? GITHUB_ORIGIN),
    false,
    token,
    options,
  );
}

export function gitlabFleetHost(url: string, token?: string, options: RemoteOptions = {}): FleetHost {
  const base = gitlabBase(url);
  return remoteFleetHost(new URL("api/v4/", base), base, true, token, options);
}

export async function fleetHostFor(gitlab?: boolean, gitlabUrl?: string): Promise<FleetHost> {
  if (gitlab || gitlabUrl !== undefined) {
    return gitlabFleetHost(gitlabUrl ?? "https://gitlab.com", process.env.GITLAB_TOKEN?.trim() || undefined);
  }
  return githubFleetHost(await githubFleetToken());
}
