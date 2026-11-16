import { resolve } from "node:path";

import { bundledRules } from "@velella/ebb/bundled-rules";
import { buildForecast } from "@velella/ebb/forecast";
import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";
import { purlIdentity } from "@velella/ebb/purl";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { declaredDependencies, parsePackageManifest } from "./detectors/npm/manifest.js";
import type { PackageManifest } from "./detectors/npm/manifest.js";
import type { ScanResult, SourceLocation, UnclassifiedReference } from "./domain.js";
import type { ScanOptions } from "./engine/index.js";
import { sortReferences } from "./engine/resolve.js";
import { forecastBuckets } from "./forecast-timeline.js";
import { readBoundedFile } from "./package-files.js";
import { childPosixPath } from "./paths.js";
import { discoverNpmWorkspaces } from "./workspaces.js";

/** The versioned Ebb forecast with the repository references that lack lifecycle coverage. */
export interface RepositoryForecast extends Forecast {
  noData: UnclassifiedReference[];
}

/** Replay detectors against the forecast's reference day without replacing the live scan cache. */
export function replayScanOptions(asOf: string): ScanOptions {
  return { scannedAt: `${asOf}T00:00:00.000Z`, noCache: true };
}

function npmIdentity(name: string, range: string): string | undefined {
  // npm aliases declare the installed package as npm:<package>@<range>.
  const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@.*)?$/u.exec(range);
  try {
    return purlIdentity(`pkg:npm/${alias?.[1] ?? name}`);
  } catch {
    return undefined;
  }
}

function noDataInManifest(contents: string, path: string, known: ReadonlySet<string>): UnclassifiedReference[] {
  let manifest: PackageManifest;
  try {
    manifest = parsePackageManifest(contents);
  } catch {
    // A malformed workspace manifest is skipped by the detector as well.
    return [];
  }
  const references: UnclassifiedReference[] = [];
  for (const [component, { range }] of declaredDependencies(manifest)) {
    if (typeof range !== "string") continue;
    const identity = npmIdentity(component, range);
    if (identity === undefined || known.has(identity)) continue;
    references.push({
      component,
      detector: "npm",
      reference: identity,
      reason: "no lifecycle rule for the package",
      location: { path },
    });
  }
  return references;
}

/** Use the scan's unclassified references plus npm declarations with no rule for their package identity. */
async function noDataComponents(
  result: ScanResult,
  rules: readonly RegistryV2Rule[],
): Promise<UnclassifiedReference[]> {
  const known = new Set(rules.map((rule) => rule.purl));
  const references = [...(result.unclassified?.references ?? [])];
  for (const directory of ["", ...(await discoverNpmWorkspaces(result.root))]) {
    const path = childPosixPath(directory, "package.json");
    const contents = (await readBoundedFile(resolve(result.root, path)))?.contents;
    if (contents !== undefined) references.push(...noDataInManifest(contents, path, known));
  }
  return sortReferences(references);
}

/** Add coverage information to the existing dated forecast without recomputing any events. */
export async function buildRepositoryForecast(result: ScanResult, months: number): Promise<RepositoryForecast> {
  const rules = await bundledRules();
  return {
    ...buildForecast(result, rules, result.scannedAt.slice(0, 10), months),
    noData: await noDataComponents(result, rules),
  };
}

function weather(events: readonly ForecastEvent[], hasNoData: boolean): "clear" | "cloudy" | "storm" {
  if (events.some(({ severity }) => severity === "high" || severity === "critical")) return "storm";
  return events.length > 0 || hasNoData ? "cloudy" : "clear";
}

/** Keep each data value on one terminal line, even when a repository supplies control characters. */
function singleLine(text: string): string {
  return text.replace(
    /\p{Cc}|\p{Zl}|\p{Zp}/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function locationText({ path, line }: SourceLocation): string {
  return line === undefined ? singleLine(path) : `${singleLine(path)}:${line}`;
}

/** Render the affected events by horizon with the original locations and explicit data gaps. */
export function renderForecastText(forecast: RepositoryForecast): string {
  const buckets = forecastBuckets(forecast);
  const affecting = buckets.map((bucket) => bucket.events.filter((event) => event.findings.length > 0));
  const lines = [
    `Weather: ${weather(affecting[0] ?? [], forecast.noData.length > 0)}`,
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
