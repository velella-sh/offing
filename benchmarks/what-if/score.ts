import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { configureActiveData, getActiveData } from "@velella/ebb/data-source";
import { simulateRepository, type TargetSimulation } from "../../src/what-if/index.js";
import { simulationTargets } from "../../src/what-if/target.js";

type Verdict = TargetSimulation["verdict"];
type Blocker = { path: string; subject: string };
type FilePin = { path: string; sha256: string };

interface Snapshot {
  commit: string;
  files: FilePin[];
  verdict: Verdict;
  blockers: Array<Blocker & { constraint: string }>;
}

interface Case {
  repository: string;
  pullRequest: number;
  mergedOn: string;
  target: string;
  witness: { path: string; before: string; after: string };
  base: Snapshot;
  merged: Snapshot;
}

const scope = new Set([
  ".node-version",
  ".nvmrc",
  ".python-version",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pyproject.toml",
]);
const pinFormat = /^[\da-f]{40}$/u;
const hashFormat = /^[\da-f]{64}$/u;
const repositoryFormat = /^[\w-]+\/[\w.-]+$/u;
const maxBytes = 4 * 1024 * 1024;
const corpus = new URL("../../../benchmarks/what-if/corpus.json", import.meta.url);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyPin(repository: string, commit: string, pin: FilePin): void {
  if (!repositoryFormat.test(repository) || repository.split("/").includes("..") || !pinFormat.test(commit)) {
    throw new Error(`Invalid public source pin: ${repository}@${commit}`);
  }
  if (!scope.has(pin.path) || !hashFormat.test(pin.sha256)) {
    throw new Error(`Invalid file pin: ${pin.path}`);
  }
}

async function fetchPinned(repository: string, commit: string, path: string): Promise<Uint8Array> {
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${path}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error(`${url} exceeds ${maxBytes} bytes`);
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

export async function readPin(repository: string, commit: string, pin: FilePin, cache: string, download: boolean) {
  verifyPin(repository, commit, pin);
  const destination = join(cache, commit, pin.path);
  let bytes = await readFile(destination).catch((error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT" || !download) throw error;
    return undefined;
  });
  const cached = bytes !== undefined;
  if (!bytes) bytes = Buffer.from(await fetchPinned(repository, commit, pin.path));
  if (bytes.length > maxBytes || digest(bytes) !== pin.sha256) {
    throw new Error(`Hash or size mismatch: ${repository}@${commit} ${pin.path}`);
  }
  if (!cached) {
    await mkdir(join(cache, commit), { recursive: true });
    await writeFile(destination, bytes);
  }
  return bytes;
}

function key({ path, subject }: Blocker): string {
  return `${path}#${subject}`;
}

export function comparePrediction(
  expected: { verdict: Verdict; blockers: readonly Blocker[] },
  actual: { verdict: Verdict; blockers: readonly Blocker[] },
) {
  const wanted = new Set(expected.blockers.map(key));
  const observed = new Set(actual.blockers.map(key));
  return {
    expected: expected.verdict,
    actual: actual.verdict,
    matched: [...wanted].filter((item) => observed.has(item)).sort(),
    missed: [...wanted].filter((item) => !observed.has(item)).sort(),
    unexpected: [...observed].filter((item) => !wanted.has(item)).sort(),
  };
}

function count(observations: ReadonlyArray<ReturnType<typeof comparePrediction>>) {
  const counts = {
    observations: observations.length,
    exactVerdicts: 0,
    knownVerdicts: 0,
    exactKnownVerdicts: 0,
    abstentions: 0,
    matchedBlockers: 0,
    missedBlockers: 0,
    unexpectedBlockers: 0,
  };
  for (const row of observations) {
    if (row.actual === row.expected) counts.exactVerdicts++;
    if (row.expected !== "unknown") {
      counts.knownVerdicts++;
      if (row.actual === row.expected) counts.exactKnownVerdicts++;
    }
    if (row.actual === "unknown") counts.abstentions++;
    counts.matchedBlockers += row.matched.length;
    counts.missedBlockers += row.missed.length;
    counts.unexpectedBlockers += row.unexpected.length;
  }
  return counts;
}

async function assess(item: Case, snapshot: Snapshot, cache: string, download: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "offing-what-if-"));
  try {
    for (const pin of snapshot.files) {
      const bytes = await readPin(item.repository, snapshot.commit, pin, cache, download);
      await writeFile(join(directory, pin.path), bytes);
    }
    const { reports } = await simulateRepository(directory, simulationTargets([item.target]), { asOf: item.mergedOn });
    const result = reports[0];
    if (!result) throw new Error(`No simulation for ${item.target}`);
    const blockers = [...result.blockers.ungrouped, ...result.blockers.roots.flatMap((root) => root.blockers)];
    return comparePrediction(snapshot, { verdict: result.verdict, blockers });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { cache: { type: "string" }, fetch: { type: "boolean" } } });
  if (!values.cache) throw new Error("Pass --cache <directory> and optionally --fetch to populate it");
  const cases = JSON.parse(await readFile(fileURLToPath(corpus), "utf8")) as Case[];
  const cache = resolve(values.cache);
  const rows = [];
  for (const item of cases) {
    rows.push({
      pullRequest: `https://github.com/${item.repository}/pull/${item.pullRequest}`,
      target: item.target,
      base: await assess(item, item.base, cache, values.fetch ?? false),
      merged: await assess(item, item.merged, cache, values.fetch ?? false),
    });
  }
  const base = count(rows.map((row) => row.base));
  const merged = count(rows.map((row) => row.merged));
  const { version } = (await getActiveData()).info;
  process.stdout.write(`${JSON.stringify({ ebbVersion: version, base, merged, rows }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureActiveData({ pinnedVersion: "bundled" });
  await main();
}
