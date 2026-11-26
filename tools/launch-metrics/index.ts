import { randomUUID } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeChart } from "./chart.js";
import { collectGitHub, GITHUB_REPOSITORY } from "./github.js";
import { collectListings, MCP_LISTING } from "./listings.js";
import { collectNpm, NPM_DOWNLOADS } from "./npm.js";

const publicEndpoints = new Set([GITHUB_REPOSITORY, NPM_DOWNLOADS, MCP_LISTING]);
const dayMilliseconds = 86_400_000;

export function isoWeek(date: Date): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / dayMilliseconds + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function collectLaunchMetrics(now: Date, fetcher: typeof fetch = globalThis.fetch) {
  const fetchPublic: typeof fetch = (input) => {
    if (typeof input !== "string" || !publicEndpoints.has(input)) {
      throw new Error("Launch metrics may only request the configured public APIs.");
    }
    return fetcher(input, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  };
  const [github, npm, listings] = await Promise.all([
    collectGitHub(fetchPublic),
    collectNpm(fetchPublic),
    collectListings(fetchPublic),
  ]);
  return { date: now.toISOString().slice(0, 10), week: isoWeek(now), github, npm, listings };
}

export type LaunchSnapshot = Awaited<ReturnType<typeof collectLaunchMetrics>>;

export async function writeSnapshot(directory: string, snapshot: LaunchSnapshot, baseline = false): Promise<string> {
  await mkdir(directory, { recursive: true });
  const file = join(directory, baseline ? "baseline.json" : `${snapshot.week}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    // Linking publishes the complete baseline atomically and fails if another run already recorded it.
    if (baseline) await link(temporary, file);
    else await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}

async function main(args: string[], now = new Date()): Promise<void> {
  const baseline = args.length === 2 && args[0] === "--baseline" && args[1] === now.toISOString().slice(0, 10);
  if (args.length > 0 && !baseline) {
    throw new Error("Usage: index.js [--baseline YYYY-MM-DD] (the confirmed launch date must be today in UTC).");
  }
  const snapshot = await collectLaunchMetrics(now);
  const directory = resolve("metrics");
  await writeSnapshot(directory, snapshot, baseline);
  if (!baseline) await writeChart(directory);
  console.log(JSON.stringify(snapshot, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
