import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { npmCli } from "../tools/npm-cli.js";

const BUDGET_MS = 10_000;
const FORECAST = /^Weather: [^\r\n]+\r?\nForecast: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}(?:\r?\n|$)/;
const FETCH = /^npm http fetch GET 200 \S+\.tgz (\d+)ms \(cache miss\)/;
const REIFY = /^npm timing reify Completed in (\d+)ms/;

type Interval = { start: number; end: number };

export interface ColdTiming {
  repository: string;
  firstOutputMs: number | null;
  downloadSpanMs: number | null;
  npmReifyMs: number | null;
  afterReifyMs: number | null;
  tarballsFetched: number;
  exitCode: number | null;
  error?: string;
}

export function observeNpmTiming(line: string, arrivedAt: number): { download?: Interval; reifyMs?: number } {
  const download = FETCH.exec(line);
  if (download) return { download: { start: arrivedAt - Number(download[1]), end: arrivedAt } };
  const reify = REIFY.exec(line);
  return reify ? { reifyMs: Number(reify[1]) } : {};
}

export function underFirstMinuteBudget(timing: ColdTiming): boolean {
  return (
    timing.exitCode === 0 &&
    timing.error === undefined &&
    timing.npmReifyMs !== null &&
    timing.downloadSpanMs !== null &&
    timing.firstOutputMs !== null &&
    timing.firstOutputMs < BUDGET_MS
  );
}

function timeNpx(spec: string, root: string, cache: string): Promise<Omit<ColdTiming, "repository">> {
  return new Promise((done) => {
    const npx = join(dirname(npmCli()), "npx-cli.js");
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [npx, "--yes", "--ignore-scripts", "--timing", "--loglevel=http", "--package", spec, "--", "offing"],
      {
        cwd: root,
        env: { ...process.env, CI: "true", npm_config_cache: cache, npm_config_registry: "https://registry.npmjs.org" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let firstOutputMs: number | null = null;
    let reify: { at: number; ms: number } | undefined;
    let error: string | undefined;
    let commandDiagnostic: string | undefined;
    const downloads: Interval[] = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, 2048);
      if (firstOutputMs === null && FORECAST.test(stdout)) firstOutputMs = performance.now() - started;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      const at = performance.now() - started;
      const lines = (stderr + chunk).split(/\r?\n/);
      stderr = lines.pop() ?? "";
      for (const line of lines) {
        const observation = observeNpmTiming(line, at);
        if (observation.download) downloads.push(observation.download);
        if (observation.reifyMs !== undefined) reify = { at, ms: observation.reifyMs };
        if (line.length > 0 && !line.startsWith("npm ")) commandDiagnostic = line;
        if (line.startsWith("npm error ")) error = line;
      }
    });
    child.on("error", (failure) => {
      error = failure.message;
    });
    child.on("close", (exitCode, signal) => {
      const failure =
        error ??
        (signal ? `npx exited on ${signal}` : undefined) ??
        (exitCode !== 0 ? (commandDiagnostic ?? `npx exited with status ${exitCode}`) : undefined) ??
        (firstOutputMs === null ? "The installed package did not print a forecast." : undefined);
      const start = Math.min(...downloads.map(({ start }) => start));
      const end = Math.max(...downloads.map(({ end }) => end));
      done({
        firstOutputMs,
        downloadSpanMs: downloads.length === 0 ? null : end - start,
        npmReifyMs: reify?.ms ?? null,
        afterReifyMs: firstOutputMs === null || reify === undefined ? null : Math.max(0, firstOutputMs - reify.at),
        tarballsFetched: downloads.length,
        exitCode,
        ...(failure === undefined ? {} : { error: failure }),
      });
    });
  });
}

async function measure(spec: string, root: string): Promise<ColdTiming> {
  // A pinned public checkout is input to Offing, never config or executables for npm.
  for (const forbidden of [".npmrc", "node_modules"]) {
    const exists = lstatSync(join(root, forbidden), { throwIfNoEntry: false });
    if (exists) throw new Error(`Benchmark repository contains ${forbidden}: ${root}`);
  }
  const temp = await realpath(process.env.RUNNER_TEMP ?? tmpdir());
  const cache = await mkdtemp(join(temp, "offing-first-minute-"));
  try {
    return { repository: basename(root), ...(await timeNpx(spec, root, cache)) };
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

function summary(rows: ColdTiming[], spec: string): string {
  const seconds = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(3));
  return [
    `### Cold first run · ${process.platform} ${process.arch}, Node ${process.version}`,
    "",
    `Package: \`${spec}\``,
    "",
    "| Repository | Tarball download span (s) | npm reify incl. downloads (s) | After reify (s) | First forecast (s) | Below 10 s |",
    "|---|---:|---:|---:|---:|---|",
    ...rows.map(
      (row) =>
        `| ${row.repository} | ${seconds(row.downloadSpanMs)} | ${seconds(row.npmReifyMs)} | ${seconds(row.afterReifyMs)} | ${seconds(row.firstOutputMs)} | ${underFirstMinuteBudget(row) ? "Pass" : "Fail"} |`,
    ),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const [, , input, evidence, ...roots] = process.argv;
  if (!input || !evidence || roots.length === 0) {
    throw new Error("Usage: first-minute <@velella/offing@version|candidate.tgz> <evidence.json> <repository>...");
  }
  const spec = input.endsWith(".tgz") ? resolve(input) : input;
  if (!/^@velella\/offing@\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec) && !spec.endsWith(".tgz")) {
    throw new Error("Specify an exact published Offing version or a local candidate tarball.");
  }
  const rows: ColdTiming[] = [];
  for (const root of roots) rows.push(await measure(spec, resolve(root)));
  const packageSource = spec.endsWith(".tgz")
    ? {
        candidate: basename(spec),
        sha256: createHash("sha256")
          .update(await readFile(spec))
          .digest("hex"),
      }
    : { published: spec };
  const markdown = summary(rows, "candidate" in packageSource ? packageSource.candidate : packageSource.published);
  await writeFile(
    evidence,
    JSON.stringify(
      {
        package: packageSource,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        budgetMs: BUDGET_MS,
        timings: rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (!rows.every(underFirstMinuteBudget)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
