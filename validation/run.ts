import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { corpusCacheKey, ensureCorpusCacheEntry } from "../benchmarks/corpus-cache.js";
import { fetchWith } from "../benchmarks/corpus-fetch.js";
import { DEFAULT_CORPUS_CONCURRENCY, inBatches } from "../benchmarks/corpus-harness.js";
import type { RepositoryForecast } from "../src/forecast.js";

interface Entry {
  repository: string;
  commit: string;
  ecosystem: string;
  selection: "targeted" | "blind";
}

interface Corpus {
  asOf: string;
  months: number;
  repositories: Entry[];
}

export const validationDir = fileURLToPath(new URL("../../validation/", import.meta.url));
const snapshotsDir = join(validationDir, "snapshots");
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

export async function readCorpus(): Promise<Corpus> {
  return JSON.parse(await readFile(join(validationDir, "repos.json"), "utf8")) as Corpus;
}

function snapshotFile(entry: Entry): string {
  return join(snapshotsDir, `${corpusCacheKey(entry)}.json`);
}

export async function readSnapshot(entry: Entry): Promise<RepositoryForecast> {
  return JSON.parse(await readFile(snapshotFile(entry), "utf8")) as RepositoryForecast;
}

/** Use a dedicated cache of complete pinned trees. The scan-only corpus may be sparse. */
export async function checkout(entry: Entry): Promise<string> {
  const cache = process.env.OFFING_FORECAST_CACHE ?? join(homedir(), ".cache", "offing-forecast-validation");
  const { path } = await ensureCorpusCacheEntry(cache, entry, async (directory) => {
    await fetchWith("shallow", directory, entry);
  });
  return path;
}

export function forecastArgs(corpus: Corpus, path: string): string[] {
  return [
    cli,
    "forecast",
    path,
    "--as-of",
    corpus.asOf,
    "--months",
    String(corpus.months),
    "--data-version",
    "bundled",
    "--json",
  ];
}

export const runCli = promisify(execFile);
export const cliLimits = { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 };
const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

async function runForecast(corpus: Corpus, entry: Entry, path: string) {
  const started = performance.now();
  const { stdout } = await runCli(process.execPath, forecastArgs(corpus, path), cliLimits);
  const durationMs = Math.round(performance.now() - started);
  const forecast = JSON.parse(stdout) as RepositoryForecast;
  return { snapshot: { ...forecast, root: entry.repository }, durationMs };
}

async function compare(entry: Entry, snapshot: RepositoryForecast): Promise<void> {
  const expected = await readFile(snapshotFile(entry), "utf8");
  assert.ok(jsonLine(snapshot) === expected, `${entry.repository}: forecast snapshot changed`);
}

async function main(record: boolean): Promise<void> {
  const corpus = await readCorpus();
  const paths = await inBatches(corpus.repositories, DEFAULT_CORPUS_CONCURRENCY, checkout);
  const timings = [];
  if (record) await mkdir(snapshotsDir, { recursive: true });
  for (const [index, entry] of corpus.repositories.entries()) {
    const path = paths[index];
    assert.ok(path);
    const { snapshot, durationMs } = await runForecast(corpus, entry, path);
    if (record) await writeFile(snapshotFile(entry), jsonLine(snapshot));
    else await compare(entry, snapshot);
    timings.push({ repository: entry.repository, durationMs });
  }
  const count = (await readdir(snapshotsDir)).filter((name) => name.endsWith(".json")).length;
  assert.equal(count, corpus.repositories.length, "snapshot count");
  if (record) {
    await writeFile(join(validationDir, "timings.json"), `${JSON.stringify(timings, null, 2)}\n`);
  }
  console.log(`${corpus.repositories.length} forecast snapshots ${record ? "recorded" : "reproduced"}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--record"), "Usage: validate [--record]");
  await main(args[0] === "--record");
}
