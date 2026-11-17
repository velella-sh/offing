import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readCorpus, readSnapshot, validationDir } from "./run.js";

interface Label {
  id: string;
  date: string;
  source: string;
  verdict: "right" | "wrong";
}

interface Review {
  repository: string;
  commit: string;
  findings: Label[];
}

const { asOf, months, repositories } = await readCorpus();
const snapshots = await Promise.all(repositories.map(readSnapshot));
const reviewed = JSON.parse(await readFile(join(validationDir, "labels.json"), "utf8")) as Review[];
assert.equal(new Set(repositories.map(({ repository }) => repository.toLowerCase())).size, repositories.length);
assert.equal(new Set(reviewed.map(({ repository }) => repository)).size, reviewed.length);
const reviews = new Map(reviewed.map((review) => [review.repository, review]));
const reviewedEcosystems = new Map<string, number>();
const ecosystemCounts = new Map<string, number>();
const gapReasons = new Map<string, number>();
const verdicts = { right: 0, wrong: 0 };

let affectedEvents = 0;
let findingLocations = 0;
let noDataReferences = 0;

for (const [index, entry] of repositories.entries()) {
  const snapshot = snapshots[index];
  assert.ok(snapshot);
  assert.equal(snapshot.root, entry.repository);
  assert.equal(snapshot.today, asOf);
  assert.equal(snapshot.months, months);
  const events = snapshot.groups.flatMap(({ events }) => events).filter(({ findings }) => findings.length > 0);
  assert.equal(snapshot.affecting, events.length);
  const findings = events.flatMap(({ findings, date, source }) =>
    findings.map(({ id }) => JSON.stringify([id, date, source])),
  );
  ecosystemCounts.set(entry.ecosystem, (ecosystemCounts.get(entry.ecosystem) ?? 0) + 1);
  affectedEvents += events.length;
  findingLocations += findings.length;
  noDataReferences += snapshot.noData.length;
  for (const { detector, reason } of snapshot.noData) {
    const key = `${detector}: ${reason}`;
    gapReasons.set(key, (gapReasons.get(key) ?? 0) + 1);
  }
  const review = reviews.get(entry.repository);
  if (!review) continue;
  assert.equal(review.commit, entry.commit);
  assert.deepEqual(
    review.findings.map(({ id, date, source }) => JSON.stringify([id, date, source])).sort(),
    findings.sort(),
    `${entry.repository}: review must label every finding exactly once`,
  );
  reviewedEcosystems.set(entry.ecosystem, (reviewedEcosystems.get(entry.ecosystem) ?? 0) + 1);
  for (const { verdict } of review.findings) {
    assert.ok(verdict === "right" || verdict === "wrong");
    verdicts[verdict]++;
  }
}
const output = {
  repositories: repositories.length,
  ecosystems: Object.fromEntries(ecosystemCounts),
  repositoriesWithFindings: snapshots.filter(({ affecting }) => affecting > 0).length,
  affectedEvents,
  findingLocations,
  reviewedRepositoriesByEcosystem: Object.fromEntries(reviewedEcosystems),
  verdicts,
  repositoriesWithGaps: snapshots.filter(({ noData }) => noData.length > 0).length,
  repositoriesWithGapsOnly: snapshots.filter(({ affecting, noData }) => affecting === 0 && noData.length > 0).length,
  noDataReferences,
  gapReasons: Object.fromEntries(gapReasons),
};
console.log(JSON.stringify(output, null, 2));
