import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type FetchEntry, sparseFingerprint } from "./corpus-fetch.js";
import { type CorpusShard, parseShard, shardEntries } from "./corpus-shard.js";
import { loadPublicCorpus } from "./public-corpus.js";

/** Only pins owned by this shard and the files the sparse checkout needs affect reuse. */
export function corpusShardCacheKeys(
  entries: readonly FetchEntry[],
  shard: CorpusShard,
  fingerprint = sparseFingerprint(),
): { key: string; prefix: string } {
  const prefix = `corpus-checkouts-${shard.index}-of-${shard.count}-${fingerprint.replace(":", "-")}-`;
  const pins = shardEntries(entries, shard).map(({ repository, commit }) => `${repository}@${commit}`);
  const hash = createHash("sha256").update(pins.sort().join("\n")).digest("hex");
  return { key: prefix + hash, prefix };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const shard = parseShard();
  if (!shard) throw new Error("Pass --shard <index>/<count> to compute a corpus checkout cache key.");
  const { key, prefix } = corpusShardCacheKeys((await loadPublicCorpus()).repositories, shard);
  console.log(`key=${key}\nprefix=${prefix}`);
}
