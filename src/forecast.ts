import { resolve } from "node:path";

import { bundledRules } from "@velella/ebb/bundled-rules";
import { purlIdentity } from "@velella/ebb/purl";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { declarationLine, declaredDependencies, parsePackageManifest } from "./detectors/npm/manifest.js";
import type { PackageManifest } from "./detectors/npm/manifest.js";
import type { ScanResult, UnclassifiedReference } from "./domain.js";
import type { ScanOptions } from "./engine/index.js";
import { sortReferences } from "./engine/resolve.js";
import { readBoundedFile } from "./package-files.js";
import { childPosixPath } from "./paths.js";
import { discoverNpmWorkspaces } from "./workspaces.js";

import { buildForecastReport } from "./forecast-core.js";
import type { RepositoryForecast } from "./forecast-core.js";

export { renderForecastText } from "./forecast-core.js";
export type { RepositoryForecast } from "./forecast-core.js";

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
  for (const [component, { range, section }] of declaredDependencies(manifest)) {
    if (typeof range !== "string") continue;
    const identity = npmIdentity(component, range);
    if (identity === undefined || known.has(identity)) continue;
    references.push({
      component,
      detector: "npm",
      reference: identity,
      reason: "no lifecycle rule for the package",
      location: { path, line: declarationLine(contents, section, component) },
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
  return buildForecastReport(
    result,
    rules,
    result.scannedAt.slice(0, 10),
    months,
    await noDataComponents(result, rules),
  );
}
