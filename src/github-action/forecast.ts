import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundledRules } from "@velella/ebb/bundled-rules";
import { buildForecast, MAX_FORECAST_MONTHS } from "@velella/ebb/forecast";
import type { Forecast } from "@velella/ebb/forecast";

import { exportRef } from "../diff.js";
import type { Finding } from "../domain.js";
import { renderForecastIcs } from "../forecast-ics.js";
import { escapeMarkdown } from "../reporters/shared.js";
import { scanWithBuiltIns } from "../scan-builtins.js";

export function readForecastMonths(input = "6"): number {
  const months = Number(input);
  if (!/^\d+$/u.test(input.trim()) || months < 1 || months > MAX_FORECAST_MONTHS)
    throw new Error(`forecast-months must be a whole number from 1 to ${MAX_FORECAST_MONTHS}.`);
  return months;
}

/** A rule starts affecting the repository or reaches its deadline sooner. File moves are immaterial. */
export function selectForecastEvents(head: Forecast, base?: Forecast): Forecast {
  const priorDates = new Map<string, string>();
  for (const { events } of base?.groups ?? []) {
    for (const event of events) {
      if (event.findings.length > 0 && !priorDates.has(event.ruleId)) priorDates.set(event.ruleId, event.date);
    }
  }
  const groups = head.groups
    .map(({ month, events }) => ({
      month,
      events: events.filter((event) => {
        if (event.findings.length === 0) return false;
        const previous = priorDates.get(event.ruleId);
        return previous === undefined || event.date < previous;
      }),
    }))
    .filter(({ events }) => events.length > 0);
  const total = groups.reduce((count, { events }) => count + events.length, 0);
  return { ...head, groups, total, affecting: total };
}

function renderForecastSummary(forecast: Forecast, pullRequest: boolean): string {
  const duration = `${forecast.months} ${forecast.months === 1 ? "month" : "months"}`;
  const lines = ["## Lifecycle forecast", "", `${forecast.today} to ${forecast.until} (${duration})`, ""];
  if (forecast.total === 0) {
    lines.push(
      pullRequest
        ? "This pull request introduces no new or earlier lifecycle deadlines in this window."
        : "No dated lifecycle events affect this repository in this window.",
    );
  } else {
    lines.push("| Deadline (UTC) | Event | Severity |", "| --- | --- | --- |");
    for (const { events } of forecast.groups) {
      for (const event of events) lines.push(`| ${event.date} | ${escapeMarkdown(event.title)} | ${event.severity} |`);
    }
  }
  return lines.join("\n") + "\n";
}

async function scanForecast(root: string, today: string, months: number, sha?: string) {
  const directory = sha === undefined ? undefined : await mkdtemp(join(tmpdir(), "offing-forecast-ref-"));
  try {
    if (directory !== undefined && sha !== undefined) exportRef(root, sha, directory);
    const scan = await scanWithBuiltIns(directory ?? root, { scannedAt: `${today}T00:00:00.000Z`, noCache: true });
    const forecast = buildForecast(scan, await bundledRules(), today, months);
    return { forecast, findings: scan.findings };
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
}

interface ForecastRefs {
  base: string | undefined;
  head: string | undefined;
}

const commitSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

async function compareForecasts(root: string, today: string, months: number, refs: ForecastRefs) {
  const { base, head } = refs;
  if (!base || !head || !commitSha.test(base) || !commitSha.test(head)) throw new Error("Missing pull request SHAs.");
  const before = await scanForecast(root, today, months, base);
  const after = await scanForecast(root, today, months, head);
  return { forecast: selectForecastEvents(after.forecast, before.forecast), findings: after.findings };
}

async function writeCalendar(directory: string, forecast: Forecast, findings: readonly Finding[]) {
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(directory, "offing-forecast-"));
    const path = join(temporary, "offing-forecast.ics");
    await writeFile(path, renderForecastIcs(forecast, findings), "utf8");
    return path;
  } catch {
    if (temporary !== undefined) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    console.log("::warning title=Offing forecast calendar skipped::Could not write offing-forecast.ics.");
    return undefined;
  }
}

/** Build one report for the summary, comment, and calendar from the same dated events. */
export async function prepareForecast(
  root: string,
  directory: string,
  today: string,
  months: number,
  refs?: ForecastRefs,
): Promise<{ summary: string; calendarPath: string | undefined } | undefined> {
  let data;
  try {
    data = refs ? await compareForecasts(root, today, months, refs) : await scanForecast(root, today, months);
  } catch {
    const reason = refs
      ? "Could not scan both pull request commits. Check out both SHAs with fetch-depth: 0."
      : "Could not scan the checkout.";
    console.log(`::warning title=Offing forecast skipped::${reason}`);
    return undefined;
  }
  const forecast = refs ? data.forecast : selectForecastEvents(data.forecast);
  const calendarPath = await writeCalendar(directory, forecast, data.findings);
  return { summary: renderForecastSummary(forecast, refs !== undefined), calendarPath };
}
