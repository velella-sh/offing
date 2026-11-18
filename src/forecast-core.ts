import type { LifecycleScan } from "@velella/ebb/domain";
import { buildForecast } from "@velella/ebb/forecast";
import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";
import type { RegistryV2Rule } from "@velella/ebb/registry";

import type { SourceLocation, UnclassifiedReference } from "./domain.js";
import { forecastBuckets } from "./forecast-timeline.js";

export interface RepositoryForecast extends Forecast {
  noData: UnclassifiedReference[];
}

export function buildForecastReport(
  scan: LifecycleScan,
  rules: readonly RegistryV2Rule[],
  today: string,
  months: number,
  noData: UnclassifiedReference[],
): RepositoryForecast {
  return { ...buildForecast(scan, rules, today, months), noData };
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
  const buckets = forecastBuckets(forecast);
  const affecting = buckets.map((bucket) => bucket.events.filter((event) => event.findings.length > 0));
  const lines = [
    `Weather: ${forecastWeather(affecting[0] ?? [], forecast.noData.length > 0)}`,
    `Forecast from ${forecast.today} to ${forecast.until} (${forecast.months} month${forecast.months === 1 ? "" : "s"})`,
  ];

  for (const [index, bucket] of buckets.entries()) {
    const events = affecting[index] ?? [];
    const other = bucket.events.length - events.length;
    lines.push("", bucket.label, `  ${events.length} affecting this repository, ${other} elsewhere`);
    for (const event of events) {
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
