import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError } from "../config.js";
import type { FleetHost } from "../fleet/host.js";
import { githubFleetHost, gitlabFleetHost } from "../fleet/remote.js";
import { readBoundedFile } from "../package-files.js";
import type { RemotePolicySnapshot } from "./cache.js";
import { isPolicyCommit, type PolicyReference } from "./reference.js";

const maxPolicyBytes = 262_144;

function hostToken(provider: PolicyReference["provider"], env: NodeJS.ProcessEnv): string | undefined {
  return provider === "github" ? env.GITHUB_TOKEN || env.GH_TOKEN : env.GITLAB_TOKEN;
}

async function responseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ConfigError("Remote policy response was empty.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxPolicyBytes) throw new ConfigError("Remote policy response exceeds the size limit.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

function commitFromResponse(text: string, provider: PolicyReference["provider"]): string {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed !== null) {
    const commit =
      provider === "github" && "sha" in parsed
        ? parsed.sha
        : provider === "gitlab" && "id" in parsed
          ? parsed.id
          : undefined;
    if (typeof commit === "string" && isPolicyCommit(commit)) return commit;
  }
  throw new ConfigError("Policy host did not return a valid commit.");
}

function commitEndpoint(reference: PolicyReference): string {
  const ref = encodeURIComponent(reference.ref);
  return reference.provider === "github"
    ? `https://api.github.com/repos/${reference.repository}/commits/${ref}`
    : `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.repository)}/repository/commits/${ref}`;
}

async function resolveCommit(reference: PolicyReference, request: typeof fetch, token?: string): Promise<string> {
  if (isPolicyCommit(reference.ref)) return reference.ref;
  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await request(commitEndpoint(reference), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ConfigError(`Remote policy ${reference.source} returned HTTP ${response.status}.`);
  }
  return commitFromResponse(await responseText(response), reference.provider);
}

function policyHost(reference: PolicyReference, token?: string): FleetHost {
  return reference.provider === "github" ? githubFleetHost(token) : gitlabFleetHost("https://gitlab.com", token);
}

async function readAtCommit(host: Pick<FleetHost, "fetchFilesAtCommit">, reference: PolicyReference, commit: string) {
  const directory = await mkdtemp(join(tmpdir(), "offing-fleet-policy-"));
  try {
    await host.fetchFilesAtCommit(
      { name: reference.repository, defaultBranch: null, archived: false, fork: false, disabled: false, topics: [] },
      commit,
      directory,
      { patterns: [`/${reference.path}`], includes: (path) => path === reference.path },
    );
    const found = await readBoundedFile(join(directory, ...reference.path.split("/")));
    if (found?.contents === undefined || Buffer.byteLength(found.contents) > maxPolicyBytes) {
      throw new ConfigError(`Policy file ${reference.path} is missing or exceeds the size limit.`);
    }
    return found.contents;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function fetchRemotePolicy(
  reference: PolicyReference,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  host?: Pick<FleetHost, "fetchFilesAtCommit">,
): Promise<RemotePolicySnapshot> {
  const token = hostToken(reference.provider, env);
  try {
    const commit = await resolveCommit(reference, request, token);
    const text = await readAtCommit(host ?? policyHost(reference, token), reference, commit);
    return { commit, text };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Cannot fetch policy ${reference.source}; check the provider, reference, and read access.`);
  }
}
