import { addMonths } from "@velella/ebb/forecast";
import { isIsoDate } from "@velella/ebb/registry";

import type { SourceLocation } from "../domain.js";

export const horizons = [3, 6, 12] as const;
export const changeKinds = ["new", "closer", "fixed"] as const;
export const unowned = "unowned";

export interface ForecastObservation {
  ruleId: string;
  location: SourceLocation;
  deadline: string | null;
  owners: string[];
}

export interface ForecastCapture {
  findings: ForecastObservation[];
  noData: string[][];
}

export interface ForecastRepository {
  host: string;
  repository: string;
  evidence?: ForecastCapture;
}

export interface ForecastItem extends Omit<ForecastObservation, "deadline"> {
  host: string;
  repository: string;
  deadline: string;
}

export interface ForecastBucket {
  months: (typeof horizons)[number];
  until: string;
  items: ForecastItem[];
}

export interface ForecastCoverage {
  classified: number;
  noData: number;
  share: number | null;
}

export interface ForecastGroup {
  name: string;
  coverage: ForecastCoverage;
  buckets: ForecastBucket[];
}

export interface FleetForecastChanges {
  new: ForecastItem[];
  closer: ForecastItem[];
  fixed: ForecastItem[];
}

export interface FleetForecast {
  schemaVersion: "offing.fleet-forecast.v1";
  today: string;
  repositoryCount: number;
  unavailable: { host: string; repository: string }[];
  coverage: ForecastCoverage;
  byOwner: ForecastGroup[];
  byRepository: (ForecastGroup & { host: string })[];
  changes?: FleetForecastChanges;
}

export function repositoryKey(host: string, repository: string): string {
  return JSON.stringify([host, repository]);
}

function observationKey(host: string, repository: string, observation: ForecastObservation): string {
  const { ruleId, location } = observation;
  return JSON.stringify([
    host,
    repository,
    ruleId,
    location.path,
    location.line,
    location.column,
    location.jsonPointer,
  ]);
}

function itemKey(item: ForecastItem): string {
  return observationKey(item.host, item.repository, item);
}

const order = (left: string, right: string): number => (left < right ? -1 : left === right ? 0 : 1);

function countCoverage(classified: number, noData: number): ForecastCoverage {
  return { classified, noData, share: classified + noData === 0 ? null : noData / (classified + noData) };
}

function grouped(name: string, today: string, evidence: ForecastCapture, items: ForecastItem[]): ForecastGroup {
  const buckets: ForecastBucket[] = horizons.map((months) => ({ months, until: addMonths(today, months), items: [] }));
  for (const item of items) {
    if (item.deadline >= today) buckets.find(({ until }) => item.deadline <= until)?.items.push(item);
  }
  return { name, coverage: countCoverage(evidence.findings.length, evidence.noData.length), buckets };
}

function datedItems({ host, repository, evidence }: ForecastRepository): ForecastItem[] {
  return (evidence?.findings ?? [])
    .flatMap(({ deadline, ...rest }) => (deadline === null ? [] : [{ host, repository, deadline, ...rest }]))
    .sort((left, right) => order(left.deadline, right.deadline) || order(itemKey(left), itemKey(right)));
}

interface GroupInput {
  evidence: ForecastCapture;
  items: ForecastItem[];
}

function groupInputs(repositories: readonly ForecastRepository[]): Map<string, GroupInput> {
  const owners = new Map<string, GroupInput>();
  const group = (owner: string): GroupInput => {
    const found = owners.get(owner);
    if (found) return found;
    const created = { evidence: { findings: [], noData: [] }, items: [] };
    owners.set(owner, created);
    return created;
  };
  for (const repository of repositories) {
    for (const finding of repository.evidence?.findings ?? []) {
      for (const owner of finding.owners) group(owner).evidence.findings.push(finding);
    }
    for (const noData of repository.evidence?.noData ?? []) {
      for (const owner of noData) group(owner).evidence.noData.push(noData);
    }
    for (const item of datedItems(repository)) {
      for (const owner of item.owners) group(owner).items.push(item);
    }
  }
  return owners;
}

function sortedItems(items: ForecastItem[]): ForecastItem[] {
  return items.sort((left, right) => order(left.deadline, right.deadline) || order(itemKey(left), itemKey(right)));
}

/** Buckets are disjoint. Coverage counts each observation once overall and once per matched owner. */
export function buildFleetForecast(repositories: readonly ForecastRepository[], today: string): FleetForecast {
  if (!isIsoDate(today)) throw new TypeError("--as-of (or --today) must be a date (YYYY-MM-DD).");
  const sorted = [...repositories].sort((left, right) =>
    order(repositoryKey(left.host, left.repository), repositoryKey(right.host, right.repository)),
  );
  const byOwner = [...groupInputs(sorted)]
    .sort(([left], [right]) => order(left, right))
    .map(([name, { evidence, items }]) => grouped(name, today, evidence, sortedItems(items)));
  const byRepository = sorted.flatMap((repository) =>
    repository.evidence
      ? [
          {
            ...grouped(repository.repository, today, repository.evidence, datedItems(repository)),
            host: repository.host,
          },
        ]
      : [],
  );
  const coverage = countCoverage(
    byRepository.reduce((count, group) => count + group.coverage.classified, 0),
    byRepository.reduce((count, group) => count + group.coverage.noData, 0),
  );
  const unavailable = sorted.flatMap(({ host, repository, evidence }) => (evidence ? [] : [{ host, repository }]));
  return {
    schemaVersion: "offing.fleet-forecast.v1",
    today,
    repositoryCount: sorted.length,
    unavailable,
    coverage,
    byOwner,
    byRepository,
  };
}

function bucketIndex(forecast: FleetForecast): Map<string, { months: number; item: ForecastItem }> {
  const index = new Map<string, { months: number; item: ForecastItem }>();
  for (const group of forecast.byRepository) {
    for (const { months, items } of group.buckets) {
      for (const item of items) index.set(itemKey(item), { months, item });
    }
  }
  return index;
}

/** Report fixes only for complete observations whose prior deadline has not passed. */
export function compareFleetForecast(
  previous: FleetForecast,
  current: FleetForecast,
  observations: readonly ForecastRepository[],
): FleetForecastChanges {
  const before = bucketIndex(previous);
  const after = bucketIndex(current);
  const present = new Map<string, Set<string>>();
  for (const { host, repository, evidence } of observations) {
    if (evidence)
      present.set(
        repositoryKey(host, repository),
        new Set(evidence.findings.map((finding) => observationKey(host, repository, finding))),
      );
  }
  const changes: FleetForecastChanges = { new: [], closer: [], fixed: [] };
  for (const [key, { months, item }] of after) {
    const old = before.get(key);
    if (!old) changes.new.push(item);
    else if (item.deadline < old.item.deadline || months < old.months) changes.closer.push(item);
  }
  for (const [key, { item }] of before) {
    if (item.deadline >= current.today && present.get(repositoryKey(item.host, item.repository))?.has(key) === false) {
      changes.fixed.push(item);
    }
  }
  return { new: sortedItems(changes.new), closer: sortedItems(changes.closer), fixed: sortedItems(changes.fixed) };
}
