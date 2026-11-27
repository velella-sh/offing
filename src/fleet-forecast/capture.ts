import { join } from "node:path";

import { bundledRules } from "@velella/ebb/bundled-rules";
import { isIsoDate } from "@velella/ebb/registry";

import { CODEOWNERS_LOCATIONS, GITLAB_CODEOWNERS_LOCATIONS, ownersOf, parseCodeowners } from "../codeowners.js";
import type { ScanResult } from "../domain.js";
import { noDataComponents } from "../forecast.js";
import { readBoundedFile } from "../package-files.js";
import type { ForecastCapture, ForecastRepository } from "./model.js";
import { unowned } from "./model.js";

export function ownershipLocations(gitlab: boolean): readonly string[] {
  return gitlab ? GITLAB_CODEOWNERS_LOCATIONS : CODEOWNERS_LOCATIONS;
}

async function repositoryCodeowners(root: string, gitlab: boolean) {
  for (const location of ownershipLocations(gitlab)) {
    const file = await readBoundedFile(join(root, location));
    if (file) return parseCodeowners(file.contents ?? "", gitlab ? "gitlab" : "github");
  }
  return [];
}

/** Collect structured observation and ownership evidence before the pinned sparse tree is removed. */
export async function captureForecast(report: ScanResult, gitlab: boolean): Promise<ForecastCapture> {
  const rules = await bundledRules();
  const owners = await repositoryCodeowners(report.root, gitlab);
  const byPath = (path: string): string[] => ownersOf(owners, path).filter(validCodeowner).sort();
  const deadlineByRule = new Map(rules.map(({ id, deadline }) => [id, deadline]));
  const findings = report.findings.map(({ ruleId, deadline, location }) => {
    const date = deadlineByRule.has(ruleId) ? deadlineByRule.get(ruleId) : deadline;
    return { ruleId, location, deadline: date && isIsoDate(date) ? date : null, owners: byPath(location.path) };
  });
  const noData = (await noDataComponents(report, rules)).map(({ location }) => byPath(location.path));
  return { findings, noData };
}

function validCodeowner(owner: string): boolean {
  return /^(?:@@?[a-z\d][a-z\d_.\/-]*|[^@\s]+@[^@\s]+)$/iu.test(owner);
}

/** A local repository-level map is only consulted when no matching file owner is present. */
export function applyFallbackOwners(
  repositories: readonly ForecastRepository[],
  owners: Readonly<Record<string, string>>,
): ForecastRepository[] {
  return repositories.map(({ host, repository, evidence }) => {
    if (!evidence) return { host, repository };
    const fallback = Object.hasOwn(owners, repository) ? (owners[repository] ?? unowned) : unowned;
    const assign = (matches: string[]): string[] => (matches.length > 0 ? matches : [fallback]);
    return {
      host,
      repository,
      evidence: {
        findings: evidence.findings.map((finding) => ({ ...finding, owners: assign(finding.owners) })),
        noData: evidence.noData.map(assign),
      },
    };
  });
}
