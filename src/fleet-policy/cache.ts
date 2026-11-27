import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultCacheDirectory } from "../cache-paths.js";
import { ConfigError } from "../config.js";
import { readBoundedFile } from "../package-files.js";
import { isPolicyCommit, type PolicyReference } from "./reference.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function entryKey(reference: PolicyReference, commit: string): string {
  return digest(`${reference.provider}:${reference.repository}/${reference.path}@${commit}`);
}

function aliasPath(root: string, reference: PolicyReference): string {
  return join(root, `${digest(reference.source)}.ref`);
}

async function writeCacheFile(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface RemotePolicySnapshot {
  commit: string;
  text: string;
}

export async function cachedPolicy(
  reference: PolicyReference,
  root = join(defaultCacheDirectory(), "fleet-policy"),
): Promise<RemotePolicySnapshot | undefined> {
  const commit = isPolicyCommit(reference.ref)
    ? reference.ref
    : (await readBoundedFile(aliasPath(root, reference)))?.contents?.trim();
  if (!commit || !isPolicyCommit(commit)) return undefined;
  const result = await readBoundedFile(join(root, `${entryKey(reference, commit)}.json`));
  if (result?.contents === undefined) return undefined;
  return { commit, text: result.contents };
}

export async function savePolicy(
  reference: PolicyReference,
  snapshot: RemotePolicySnapshot,
  root = join(defaultCacheDirectory(), "fleet-policy"),
): Promise<void> {
  if (!isPolicyCommit(snapshot.commit) || (isPolicyCommit(reference.ref) && reference.ref !== snapshot.commit)) {
    throw new ConfigError(`Remote policy ${reference.source} did not resolve to its expected commit.`);
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeCacheFile(join(root, `${entryKey(reference, snapshot.commit)}.json`), snapshot.text);
  if (!isPolicyCommit(reference.ref)) await writeCacheFile(aliasPath(root, reference), `${snapshot.commit}\n`);
}
