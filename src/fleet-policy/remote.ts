import { ConfigError } from "../config.js";
import type { RemotePolicySnapshot } from "./cache.js";
import { isPolicyCommit, type PolicyReference } from "./reference.js";

const maxPolicyBytes = 262_144;

function requestHeaders(provider: PolicyReference["provider"], env: NodeJS.ProcessEnv, raw: boolean): Headers {
  const headers = new Headers({ accept: raw ? "application/vnd.github.raw+json" : "application/json" });
  const token = provider === "github" ? env.GITHUB_TOKEN || env.GH_TOKEN : env.GITLAB_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
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

function endpoints(reference: PolicyReference) {
  const ref = encodeURIComponent(reference.ref);
  if (reference.provider === "github") {
    const base = `https://api.github.com/repos/${reference.repository}`;
    const path = reference.path.split("/").map(encodeURIComponent).join("/");
    return {
      commit: `${base}/commits/${ref}`,
      content: (sha: string) => `${base}/contents/${path}?ref=${sha}`,
    };
  }
  const base = `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.repository)}/repository`;
  const path = encodeURIComponent(reference.path);
  return {
    commit: `${base}/commits/${ref}`,
    content: (sha: string) => `${base}/files/${path}/raw?ref=${sha}`,
  };
}

export async function fetchRemotePolicy(
  reference: PolicyReference,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RemotePolicySnapshot> {
  const paths = endpoints(reference);
  const read = async (url: string, raw: boolean) => {
    const response = await request(url, {
      headers: requestHeaders(reference.provider, env, raw && reference.provider === "github"),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConfigError(`Remote policy ${reference.source} returned HTTP ${response.status}.`);
    }
    return responseText(response);
  };
  try {
    const commit = isPolicyCommit(reference.ref)
      ? reference.ref
      : commitFromResponse(await read(paths.commit, false), reference.provider);
    return { commit, text: await read(paths.content(commit), true) };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Cannot fetch policy ${reference.source}; check the provider, reference, and read access.`);
  }
}
