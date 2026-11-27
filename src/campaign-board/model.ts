import { createHash } from "node:crypto";

import type { CampaignRepository, CampaignState } from "../campaign/document.js";
import { repositoryKey } from "../fleet-forecast/model.js";

function isComplete(status: CampaignRepository["status"]): boolean {
  return status === "merged" || status === "cancelled";
}

function progress(rows: readonly CampaignRepository[]) {
  return {
    total: rows.length,
    complete: rows.filter(({ status }) => isComplete(status)).length,
    merged: rows.filter(({ status }) => status === "merged").length,
    awaitingReview: rows.filter(({ status }) => status === "review").length,
  };
}

function addToGroup<Key>(groups: Map<Key, CampaignRepository[]>, key: Key, repository: CampaignRepository): void {
  const group = groups.get(key);
  if (group) group.push(repository);
  else groups.set(key, [repository]);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownerProgress(repositories: readonly CampaignRepository[]) {
  const groups = new Map<string | null, CampaignRepository[]>();
  for (const repository of repositories) {
    const owners = repository.owners.length > 0 ? new Set(repository.owners) : [null];
    for (const owner of owners) addToGroup(groups, owner, repository);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compare(left ?? "", right ?? ""))
    .map(([owner, rows]) => ({
      id: owner === null ? "unassigned" : identifier(owner),
      owner: owner ?? "Unassigned",
      ...progress(rows),
    }));
}

function identifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function batchActivity(rows: readonly CampaignRepository[]) {
  const groups = new Map<number, CampaignRepository[]>();
  for (const repository of rows) addToGroup(groups, repository.batch, repository);
  return [...groups].map(([batch, repositories]) => {
    let start: string | null = null;
    let latest: string | null = null;
    for (const { transitions } of repositories) {
      const first = transitions[0]?.at;
      const last = transitions.at(-1)?.at;
      if (first && (start === null || first < start)) start = first;
      if (last && (latest === null || last > latest)) latest = last;
    }
    const end = repositories.every(({ status }) => isComplete(status)) ? latest : null;
    return { id: `batch-${batch}`, label: `Batch ${batch}`, start, end, status: batchStatus(start, end) };
  });
}

function batchStatus(start: string | null, end: string | null): "completed" | "incomplete" | "queued" {
  return end ? "completed" : start ? "incomplete" : "queued";
}

function projection(ends: readonly string[], remaining: number, observedAt: string) {
  const first = ends[0];
  const last = ends.at(-1);
  const meanIntervalMs =
    first && last && ends.length >= 2 ? (Date.parse(last) - Date.parse(first)) / (ends.length - 1) : null;
  const estimate =
    remaining > 0 && meanIntervalMs !== null && meanIntervalMs > 0
      ? new Date(Date.parse(observedAt) + Math.ceil(remaining * meanIntervalMs))
      : null;
  return {
    completedBatches: ends.length,
    remainingBatches: remaining,
    meanIntervalMs,
    projectedFinish:
      estimate && Number.isFinite(estimate.getTime()) && estimate.getUTCFullYear() <= 9999
        ? estimate.toISOString()
        : null,
  };
}

export function campaignBoard(state: CampaignState) {
  const rows = state.repositories;
  const activity = batchActivity(rows);
  const completed = activity.flatMap(({ end }) => (end ? [end] : [])).sort();
  let observedAt = `${state.asOf}T00:00:00.000Z`;
  for (const { transitions } of rows) {
    const latest = transitions.at(-1)?.at;
    if (latest && latest > observedAt) observedAt = latest;
  }
  return {
    repositories: rows.map(({ host, name, batch, owners, status, commit, deadline }) => ({
      id: identifier(repositoryKey(host, name)),
      repository: `${host}/${name}`,
      batch,
      owners: owners.length > 0 ? [...new Set(owners)].sort().join(", ") : "Unassigned",
      status,
      commit,
      deadline,
    })),
    owners: ownerProgress(rows),
    activity: activity.filter(({ start }) => start !== null),
    summary: {
      id: state.id,
      asOf: state.asOf,
      observedAt,
      omitted: state.omissions.length,
      ...progress(rows),
      ...projection(completed, activity.length - completed.length, observedAt),
    },
  };
}
