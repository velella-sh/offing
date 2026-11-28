import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { parseArgs, promisify } from "node:util";
import { DEFAULT_FORECAST_MONTHS } from "@velella/ebb/forecast";
import { isIsoDate } from "@velella/ebb/registry";
import type { CommandContext } from "../commands/types.js";
import type { ScanResult } from "../domain.js";
import { forecastWeather, locationText, singleLine } from "../forecast-core.js";
import { buildRepositoryForecast, replayScanOptions, type RepositoryForecast } from "../forecast.js";
import { scanWithBuiltIns } from "../scan-builtins.js";

const execute = promisify(execFile);
const exampleUrl = "https://github.com/velella-sh/offing/blob/main/docs/QUICKSTART.md#try-the-demo";

async function hasGitHistory(root: string): Promise<boolean> {
  try {
    await execute("git", ["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"], {
      // On Windows, executable lookup can search the child's working directory.
      cwd: dirname(process.execPath),
      timeout: 1000,
    });
    return true;
  } catch {
    return false;
  }
}

function renderFirstRun(scan: ScanResult, forecast: RepositoryForecast, empty: boolean, history: boolean): string {
  const upcoming = forecast.buckets.flatMap(({ events }) => events);
  const nearest = forecast.buckets[0]?.events ?? [];
  const lines = [
    `Weather: ${forecastWeather(nearest, forecast.noData.length > 0)}`,
    `Forecast: ${forecast.today} to ${forecast.until}`,
    `Lifecycle findings: ${scan.findings.length}; upcoming deadlines: ${upcoming.length}; no data: ${forecast.noData.length}.`,
  ];
  for (const finding of scan.findings.slice(0, 3)) {
    lines.push(`  ${finding.severity.toUpperCase()} ${singleLine(finding.title)} (${locationText(finding.location)})`);
  }
  for (const event of upcoming.slice(0, 3)) {
    lines.push(`  ${event.date} ${singleLine(event.title)}`);
  }
  if (empty) {
    lines.push(
      "This folder is empty. Offing looks for manifests, lockfiles, and CI workflows.",
      `Try the demo: ${exampleUrl}`,
    );
  }
  if (!history) lines.push("Git history is not available; Offing scanned the files on disk.");
  lines.push(
    "",
    "Next: offing forecast",
    "Next: offing init --hooks",
    "Next: offing init --agents (add agent guard instructions)",
  );
  return `${lines.join("\n")}\n`;
}

/** The default invocation is read-only and never asks for input, even on a terminal. */
export async function runOnboarding(args: readonly string[], ctx: CommandContext): Promise<number> {
  let asOf: string | undefined;
  let json: boolean | undefined;
  try {
    const { values } = parseArgs({
      args: [...args],
      options: { "as-of": { type: "string" }, json: { type: "boolean" } },
    });
    asOf = values["as-of"];
    json = values.json;
  } catch {
    return ctx.fail("usage", "Usage: offing [--as-of <YYYY-MM-DD>] [--json]");
  }
  if (asOf !== undefined && !isIsoDate(asOf)) return ctx.fail("usage", "--as-of must be a date (YYYY-MM-DD).");
  if (json) {
    const { command } = await import("../commands/forecast.js");
    return command.run(asOf === undefined ? ["--json"] : ["--json", "--as-of", asOf], ctx, true);
  }
  return runFirstForecast(asOf);
}

/** The bare executable shares this path without importing the full command table. */
export async function runFirstForecast(asOf?: string): Promise<number> {
  const root = process.cwd();
  const [scan, entries, history] = await Promise.all([
    scanWithBuiltIns(root, asOf === undefined ? { noCache: true } : replayScanOptions(asOf)),
    readdir(root),
    hasGitHistory(root),
  ]);
  const forecast = await buildRepositoryForecast(scan, DEFAULT_FORECAST_MONTHS);
  process.stdout.write(
    renderFirstRun(
      scan,
      forecast,
      entries.every((entry) => entry === ".git"),
      history,
    ),
  );
  // Historical forecasts have no equivalent Autopilot invocation.
  if (asOf === undefined) await printAutopilotPreview(scan);
  return 0;
}

async function printAutopilotPreview(scan: ScanResult): Promise<void> {
  let count = 0;
  if (scan.findings.length > 0) {
    const { countFirstWaveCodemods } = await import("../autopilot/plan.js");
    const assessed = await countFirstWaveCodemods(scan).catch(() => undefined);
    if (assessed === undefined) return;
    count = assessed;
  }
  process.stdout.write(
    count === 0
      ? "There is nothing for Autopilot to fix.\n"
      : `Autopilot can fix ${count}; run offing autopilot . --dry-run --wave 0 to preview.\n`,
  );
}
