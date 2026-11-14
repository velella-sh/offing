import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { measureMonorepoScan } from "./monorepo.js";

/**
 * Observational suite: scan the five largest public monorepos that fit a nightly
 * Actions checkout, record wall time and peak RSS, and publish the table. Pins live
 * in large-monorepos.json. The harness never fetches; the workflow checks out each
 * commit before the scan.
 */

export const SUITE_PATH = resolve("benchmarks/large-monorepos.json");
export const SUITE_SIZE = 5;

export interface LargeMonorepoPin {
  readonly id: string;
  readonly repository: string;
  readonly commit: string;
}

export interface LargeMonorepoSuite {
  readonly schemaVersion: "offing.large-monorepos.v1";
  readonly description: string;
  readonly repositories: readonly LargeMonorepoPin[];
}

export interface LargeMonorepoMeasurement {
  readonly id: string;
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly fileCount: number;
  readonly meanWallMs: number;
  readonly peakRssBytes: number;
  readonly findingsCount: number;
  readonly wallMsPerRun: readonly number[];
}

export interface LargeMonorepoSuiteResult {
  readonly schemaVersion: "offing.large-monorepos-result.v1";
  readonly timestamp: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly measurements: readonly LargeMonorepoMeasurement[];
}

export function loadLargeMonorepoSuite(path = SUITE_PATH): LargeMonorepoSuite {
  const raw = JSON.parse(readFileSync(path, "utf8")) as LargeMonorepoSuite;
  if (raw.schemaVersion !== "offing.large-monorepos.v1") {
    throw new Error(`unexpected suite schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (!Array.isArray(raw.repositories) || raw.repositories.length !== SUITE_SIZE) {
    throw new Error(`suite must list exactly ${SUITE_SIZE} repositories`);
  }
  for (const entry of raw.repositories) {
    validatePin(entry);
  }
  const ids = new Set(raw.repositories.map((entry) => entry.id));
  if (ids.size !== raw.repositories.length) throw new Error("suite repository ids must be unique");
  return raw;
}

function validatePin(entry: LargeMonorepoPin): void {
  if (!/^[a-z][a-z0-9-]*$/.test(entry.id)) throw new Error(`invalid suite id: ${entry.id}`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repository)) {
    throw new Error(`invalid repository: ${entry.repository}`);
  }
  if (!/^[0-9a-f]{40}$/.test(entry.commit)) {
    throw new Error(`commit for ${entry.repository} must be a 40-character lowercase hex SHA`);
  }
}

/** Resolves `<root>/<id>` for each pin. Missing directories are an error — checkout is outside this harness. */
export function resolveSuiteTargets(
  suite: LargeMonorepoSuite,
  root: string,
  only?: readonly string[],
): readonly { pin: LargeMonorepoPin; path: string }[] {
  const selected = only === undefined ? suite.repositories : suite.repositories.filter((pin) => only.includes(pin.id));
  if (only !== undefined && selected.length !== only.length) {
    const known = new Set(suite.repositories.map((pin) => pin.id));
    const missing = only.filter((id) => !known.has(id));
    throw new Error(`unknown suite id(s): ${missing.join(", ")}`);
  }
  return selected.map((pin) => {
    const path = resolve(root, pin.id);
    if (!existsSync(path)) throw new Error(`missing checkout for ${pin.id} at ${path}`);
    return { pin, path };
  });
}

export async function measureSuiteTargets(
  targets: readonly { pin: LargeMonorepoPin; path: string }[],
  options: { readonly warmupRuns?: number; readonly measuredRuns?: number } = {},
): Promise<LargeMonorepoSuiteResult> {
  const measurements: LargeMonorepoMeasurement[] = [];
  for (const target of targets) {
    measurements.push(await measureOne(target.pin, target.path, options));
  }
  return {
    schemaVersion: "offing.large-monorepos-result.v1",
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    measurements,
  };
}

async function measureOne(
  pin: LargeMonorepoPin,
  path: string,
  options: { readonly warmupRuns?: number; readonly measuredRuns?: number },
): Promise<LargeMonorepoMeasurement> {
  const measured = await measureMonorepoScan({
    targetDir: path,
    warmupRuns: options.warmupRuns ?? 1,
    measuredRuns: options.measuredRuns ?? 1,
    noCache: true,
  });
  try {
    return {
      id: pin.id,
      repository: pin.repository,
      commit: pin.commit,
      path,
      fileCount: measured.measurements.fileCount,
      meanWallMs: measured.measurements.meanWallMs,
      peakRssBytes: measured.measurements.peakRssBytes,
      findingsCount: measured.measurements.findingsCount,
      wallMsPerRun: measured.measurements.wallMsPerRun,
    };
  } finally {
    await measured.cleanup();
  }
}

export function mergeSuiteResults(results: readonly LargeMonorepoSuiteResult[]): LargeMonorepoSuiteResult {
  if (results.length === 0) throw new Error("no suite results to merge");
  const byId = new Map<string, LargeMonorepoMeasurement>();
  for (const result of results) {
    for (const measurement of result.measurements) byId.set(measurement.id, measurement);
  }
  const suite = loadLargeMonorepoSuite();
  const measurements = suite.repositories.map((pin) => {
    const measurement = byId.get(pin.id);
    if (measurement === undefined) throw new Error(`merged results are missing ${pin.id}`);
    return measurement;
  });
  const first = results[0]!;
  return {
    schemaVersion: "offing.large-monorepos-result.v1",
    timestamp: new Date().toISOString(),
    platform: first.platform,
    arch: first.arch,
    nodeVersion: first.nodeVersion,
    measurements,
  };
}

export function formatSuiteMarkdown(result: LargeMonorepoSuiteResult): string {
  const rows = result.measurements.map((measurement) => {
    const wall = measurement.meanWallMs.toFixed(0);
    const rss = (measurement.peakRssBytes / 1024 / 1024).toFixed(0);
    return `| \`${measurement.repository}\` | \`${measurement.commit.slice(0, 12)}\` | ${measurement.fileCount} | ${wall} | ${rss} | ${measurement.findingsCount} |`;
  });
  return [
    "## Large public monorepo scan times",
    "",
    `Recorded ${result.timestamp} on ${result.platform}/${result.arch}, Node.js ${result.nodeVersion}. Scans are offline (\`noCache: true\`); checkout time is excluded.`,
    "",
    "| Repository | Commit | Files | Mean wall (ms) | Peak RSS (MB) | Findings |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
  ].join("\n");
}

export function writeSuiteResult(result: LargeMonorepoSuiteResult, outputPath: string): void {
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

export function loadSuiteResultsFromDirectory(directory: string): LargeMonorepoSuiteResult[] {
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (entries.length === 0) throw new Error(`no JSON results in ${directory}`);
  return entries.map((name) => {
    const raw = JSON.parse(readFileSync(join(directory, name), "utf8")) as LargeMonorepoSuiteResult;
    if (raw.schemaVersion !== "offing.large-monorepos-result.v1") {
      throw new Error(`unexpected result schema in ${name}`);
    }
    return raw;
  });
}

interface CliOptions {
  readonly root: string | undefined;
  readonly only: readonly string[] | undefined;
  readonly mergeDir: string | undefined;
  readonly output: string | undefined;
  readonly summaryPath: string | undefined;
  readonly json: boolean;
  readonly warmupRuns: number;
  readonly measuredRuns: number;
}

function parseArgv(argv: readonly string[]): CliOptions {
  const draft: {
    root: string | undefined;
    only: string[] | undefined;
    mergeDir: string | undefined;
    output: string | undefined;
    summaryPath: string | undefined;
    json: boolean;
    warmupRuns: number;
    measuredRuns: number;
  } = {
    root: undefined,
    only: undefined,
    mergeDir: undefined,
    output: undefined,
    summaryPath: undefined,
    json: false,
    warmupRuns: 1,
    measuredRuns: 1,
  };
  const number = (flag: string): number => {
    const raw = argv[argv.indexOf(flag) + 1];
    if (raw === undefined || !Number.isFinite(Number(raw))) throw new Error(`${flag} expects a number`);
    return Number(raw);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") draft.root = argv[++i];
    else if (arg === "--only") draft.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--merge") draft.mergeDir = argv[++i];
    else if (arg === "--output") draft.output = argv[++i];
    else if (arg === "--summary") draft.summaryPath = argv[++i];
    else if (arg === "--json") draft.json = true;
    else if (arg === "--warmup") draft.warmupRuns = number("--warmup");
    else if (arg === "--runs") draft.measuredRuns = number("--runs");
    else if (arg === "--list") {
      console.log(JSON.stringify(loadLargeMonorepoSuite().repositories, null, 2));
      process.exit(0);
    }
  }
  return draft;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgv(argv);
  let result: LargeMonorepoSuiteResult;
  if (options.mergeDir) {
    result = mergeSuiteResults(loadSuiteResultsFromDirectory(resolve(options.mergeDir)));
  } else {
    if (options.root === undefined) {
      throw new Error("Usage: large-monorepos --root <checkouts-dir> [--only id] | --merge <dir>");
    }
    const suite = loadLargeMonorepoSuite();
    const targets = resolveSuiteTargets(suite, options.root, options.only);
    result = await measureSuiteTargets(targets, {
      warmupRuns: options.warmupRuns,
      measuredRuns: options.measuredRuns,
    });
  }
  if (options.output) writeSuiteResult(result, resolve(options.output));
  const markdown = formatSuiteMarkdown(result);
  if (options.summaryPath) appendFileSync(options.summaryPath, `${markdown}\n`);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli();
}
