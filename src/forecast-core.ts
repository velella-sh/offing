import type { LifecycleScan } from "@velella/ebb/domain";
import { buildForecast } from "@velella/ebb/forecast";
import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";
import type { RegistryV2Rule } from "@velella/ebb/registry";

import type { SourceLocation, UnclassifiedReference } from "./domain.js";
import { forecastBuckets } from "./forecast-timeline.js";
import type { ForecastBucket } from "./forecast-timeline.js";

export interface RepositoryForecast extends Forecast {
  /** Events by horizon, the grouping the terminal report prints. */
  buckets: ForecastBucket[];
  noData: UnclassifiedReference[];
}

export function buildForecastReport(
  scan: LifecycleScan,
  rules: readonly RegistryV2Rule[],
  today: string,
  months: number,
  noData: UnclassifiedReference[],
): RepositoryForecast {
  const { groups, affecting, total, ...head } = buildForecast(scan, rules, today, months);
  // The buckets come before the month groups: they are the short answer the groups spell out.
  const buckets = forecastBuckets({ ...head, groups, affecting, total });
  return { ...head, buckets, groups, affecting, total, noData };
}

export function forecastWeather(events: readonly ForecastEvent[], hasNoData: boolean): "clear" | "cloudy" | "storm" {
  if (events.some(({ severity }) => severity === "high" || severity === "critical")) return "storm";
  return events.length > 0 || hasNoData ? "cloudy" : "clear";
}

/** Keep each data value on one terminal line, even when a repository supplies control characters. */
export function singleLine(text: string): string {
  return text.replace(
    /\p{Cc}|\p{Zl}|\p{Zp}/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function locationText({ path, line }: SourceLocation): string {
  return line === undefined ? singleLine(path) : `${singleLine(path)}:${line}`;
}

/** Render the affected events by horizon with the original locations and explicit data gaps. */
export function renderForecastText(forecast: RepositoryForecast): string {
  const lines = [
    `Weather: ${forecastWeather(forecast.buckets[0]?.events ?? [], forecast.noData.length > 0)}`,
    `Forecast from ${forecast.today} to ${forecast.until} (${forecast.months} month${forecast.months === 1 ? "" : "s"})`,
  ];

  for (const bucket of forecast.buckets) {
    lines.push(
      "",
      bucket.label,
      `  ${bucket.affecting} affecting this repository, ${bucket.total - bucket.affecting} elsewhere`,
    );
    for (const event of bucket.events) {
      lines.push(`  ${event.date}  ${singleLine(event.title)} [${event.severity}] (${singleLine(event.ruleId)})`);
      for (const finding of event.findings) lines.push(`    ${locationText(finding)}`);
    }
  }

  if (forecast.noData.length > 0) {
    lines.push("", "No data");
    for (const { component, reference, reason, location } of forecast.noData) {
      lines.push(
        `  ${singleLine(component)} (${singleLine(reference)}) at ${locationText(location)}: ${singleLine(reason)}`,
      );
    }
  }
  return lines.join("\n");
}
