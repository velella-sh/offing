/** Only the opt-in CLI imports this module. The offline lineage graph never calls a registry. */
import { parseImageReference, type ImageReference } from "../detectors/container/parse-image.js";
import { digestKey, type DigestTags, type ImageLineage } from "./index.js";

const HUB = "https://hub.docker.com";
const GHCR = "https://ghcr.io";
const MAXIMUM_BODY = 2 * 1024 * 1024;
const MAXIMUM_HUB_PAGES = 10;
const MAXIMUM_GHCR_TAGS = 128;
const MAXIMUM_REPOSITORIES = 8;
const ACCEPT_MANIFEST = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

interface Tags {
  tags: Map<string, Set<string>>;
  complete: boolean;
}

type Client = (url: URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Registry request failed.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      bytes += value.byteLength;
      if (bytes > MAXIMUM_BODY) throw new Error("Registry response exceeds the limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function addTag(result: Tags, repository: string, name: string, digest: string): void {
  const parsed = parseImageReference(`${repository}:${name}@${digest}`);
  if (parsed?.tag !== name || parsed.digest !== digest) return;
  const tags = result.tags.get(digest);
  if (tags) tags.add(name);
  else result.tags.set(digest, new Set([name]));
}

async function hubTags(repository: string, request: Client): Promise<Tags> {
  const result: Tags = { tags: new Map(), complete: false };
  const [namespace, name, nested] = repository.split("/");
  if (!namespace || !name || nested !== undefined) return result;
  const url = new URL(`/v2/namespaces/${namespace}/repositories/${name}/tags`, HUB);
  url.searchParams.set("page_size", "100");
  for (let page = 1; page <= MAXIMUM_HUB_PAGES; page++) {
    url.searchParams.set("page", String(page));
    const response = await json(await request(url));
    if (!record(response) || !Array.isArray(response.results)) return result;
    for (const entry of response.results) {
      if (record(entry) && typeof entry.name === "string" && typeof entry.digest === "string") {
        addTag(result, repository, entry.name, entry.digest);
      }
    }
    if (response.next === null) return { ...result, complete: true };
    if (typeof response.next !== "string") return result;
  }
  return result;
}

async function ghcrToken(repository: string, request: Client): Promise<string> {
  const endpoint = new URL("/token", GHCR);
  endpoint.searchParams.set("service", "ghcr.io");
  endpoint.searchParams.set("scope", `repository:${repository}:pull`);
  const token = await json(await request(endpoint));
  if (!record(token) || typeof token.token !== "string" || !/^[a-zA-Z0-9._~+/=-]{1,4096}$/.test(token.token)) {
    throw new Error("Registry token unavailable.");
  }
  return token.token;
}

async function ghcrTags(repository: string, request: Client): Promise<Tags> {
  const result: Tags = { tags: new Map(), complete: false };
  const headers = { Authorization: `Bearer ${await ghcrToken(repository, request)}`, Accept: ACCEPT_MANIFEST };
  const url = new URL(`/v2/${repository}/tags/list?n=${MAXIMUM_GHCR_TAGS}`, GHCR);
  const response = await request(url, { headers });
  const body = await json(response);
  if (!record(body) || !Array.isArray(body.tags)) return result;
  let complete = response.headers.get("link") === null && body.tags.length <= MAXIMUM_GHCR_TAGS;
  for (const tag of body.tags.slice(0, MAXIMUM_GHCR_TAGS)) {
    if (typeof tag !== "string" || parseImageReference(`ghcr.io/${repository}:${tag}`)?.tag !== tag) continue;
    const manifest = await request(new URL(`/v2/${repository}/manifests/${tag}`, GHCR), { method: "HEAD", headers });
    const digest = manifest.headers.get("docker-content-digest");
    await manifest.body?.cancel();
    if (manifest.ok && digest) addTag(result, repository, tag, digest);
    else complete = false;
  }
  return { ...result, complete };
}

function eligible(image: ImageReference | undefined): image is ImageReference {
  return image?.digest !== undefined && image.tag === undefined && ["docker.io", "ghcr.io"].includes(image.registry);
}

function scanRegistries(result: ImageLineage): Map<string, ImageReference> {
  const unique = new Map<string, ImageReference>();
  for (const { links } of result.chains) {
    for (const link of links) {
      if (link.digest === undefined) continue;
      const image = parseImageReference(link.resolvedReference ?? link.reference);
      if (eligible(image)) unique.set(digestKey(image), image);
    }
  }
  return unique;
}

/** A bounded lookup over public HTTPS endpoints, with a shared in-memory listing for each repository. */
export async function resolveLineageDigests(
  result: ImageLineage,
  fetchRegistry: typeof fetch = fetch,
): Promise<Map<string, DigestTags>> {
  const abort = AbortSignal.timeout(20_000);
  const request: Client = (url, init) =>
    fetchRegistry(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([abort, AbortSignal.timeout(5_000)]),
    });
  const cache = new Map<string, Tags>();
  const output = new Map<string, DigestTags>();
  for (const [key, image] of scanRegistries(result)) {
    const repository = `${image.registry}/${image.repository}`;
    const load = image.registry === "docker.io" ? hubTags : ghcrTags;
    if (!cache.has(repository)) {
      if (cache.size >= MAXIMUM_REPOSITORIES || abort.aborted) break;
      cache.set(repository, await load(image.repository, request).catch(() => ({ tags: new Map(), complete: false })));
    }
    const listing = cache.get(repository);
    const tags = image.digest === undefined ? undefined : listing?.tags.get(image.digest);
    if (listing && tags) output.set(key, { tags: [...tags].sort(), complete: listing.complete });
  }
  return output;
}
