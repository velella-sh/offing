import type { AccuracyCounts, AccuracyMiss, ArchivedCorpusRun } from "../benchmarks/corpus-run-archive.js";
import { maturityLevels } from "../benchmarks/thresholds.js";
import type { FullRunRecord, MaturityLevel, Thresholds } from "../benchmarks/thresholds.js";

export const HELD_OUT_RESULT_FILE = "benchmarks/held-out-result.json";

export interface HeldOutResult {
  scope: string[];
  run?: { date: string; commit: string; ebbVersion: string };
  summary: AccuracyCounts & { repositories: number };
  repositories: Array<{ repository: string; commit: string; missing: string[]; unexpected: string[] }>;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

export function accuracyCounts(counts: AccuracyCounts) {
  const { truePositives, falsePositives, falseNegatives } = counts;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

const emptyCounts: AccuracyCounts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };

function maturityCounts(run: FullRunRecord, level: MaturityLevel, detectors: Thresholds["detectors"]) {
  const totals = { ...emptyCounts };
  let measured = false;
  for (const [id, scores] of Object.entries(run.perDetector)) {
    if (detectors[id]?.level !== level) continue;
    measured = true;
    totals.truePositives += scores.truePositives;
    totals.falsePositives += scores.falsePositives;
    totals.falseNegatives += scores.falseNegatives;
  }
  return measured ? accuracyCounts(totals) : null;
}

export function runProvenance(run: FullRunRecord | undefined, ebbVersion: string | undefined) {
  return {
    date: run?.date ?? "not recorded",
    commit: run?.commit ?? "not recorded",
    ebbVersion: ebbVersion ?? "not recorded",
    runRepositories: run?.repositories ?? "not recorded",
  };
}

function missLink({ finding, repository, commit, kind }: AccuracyMiss): string {
  const [ruleId, ...location] = finding.split(":");
  const line = location.pop();
  const path = location.join(":").split("/").map(encodeURIComponent).join("/");
  const label = `${kind === "missing" ? "Missing" : "Unexpected"}: ${ruleId}`.replace(/[\[\]\\]/g, "\\$&");
  const [owner, repo] = repository.split("/").map(encodeURIComponent);
  const anchor = line && /^\d+$/.test(line) ? `#L${line}` : "";
  return `- [${label} in ${owner}/${repo}](https://github.com/${owner}/${repo}/blob/${commit}/${path}${anchor})`;
}

function ecosystemTrend(archives: readonly ArchivedCorpusRun[], id: string) {
  return archives.flatMap((run) => {
    const scores = run.perEcosystem[id];
    if (!scores) return [];
    const { precision, recall } = accuracyCounts(scores);
    if (precision === null || recall === null) return [];
    return [
      {
        date: run.date,
        commit: run.commit,
        ebbVersion: run.ebbVersion,
        repositories: scores.repositories,
        precision,
        recall,
      },
    ];
  });
}

function ecosystemAccuracy(ids: readonly string[], current: ArchivedCorpusRun | undefined) {
  return ids
    .map((id) => {
      const summary = current?.perEcosystem[id];
      return {
        id,
        ...runProvenance(current, current?.ebbVersion),
        repositories: summary?.repositories ?? "not measured",
        scores: summary ? accuracyCounts(summary) : null,
        misses: summary?.misses.map(missLink) ?? [],
      };
    })
    .sort(
      (a, b) =>
        (a.scores?.recall ?? Infinity) - (b.scores?.recall ?? Infinity) ||
        (a.scores?.precision ?? Infinity) - (b.scores?.precision ?? Infinity) ||
        a.id.localeCompare(b.id, "en"),
    );
}

function summarizeHeldOut(heldOut: HeldOutResult) {
  return {
    scope: heldOut.scope,
    repositories: heldOut.summary.repositories,
    ...accuracyCounts(heldOut.summary),
    date: heldOut.run?.date ?? "not recorded",
    commit: heldOut.run?.commit ?? "not recorded",
    ebbVersion: heldOut.run?.ebbVersion ?? "not recorded",
    misses: heldOut.repositories.flatMap(({ repository, commit, missing, unexpected }) =>
      [
        ...missing.map((finding) => ({ finding, kind: "missing" as const })),
        ...unexpected.map((finding) => ({ finding, kind: "unexpected" as const })),
      ].map((miss) => missLink({ repository, commit, ...miss })),
    ),
  };
}

export function buildDashboardAccuracy(
  thresholds: Thresholds,
  ecosystems: readonly string[],
  archives: readonly ArchivedCorpusRun[],
  heldOut?: HeldOutResult,
) {
  const last = thresholds.lastFullRun;
  const current = archives.find((run) => run.date === last?.date && run.commit === last.commit);
  return {
    provenance: runProvenance(last, current?.ebbVersion),
    ecosystems: ecosystemAccuracy(ecosystems, current),
    trends: Object.fromEntries(
      ecosystems.map((id) => [
        id,
        ecosystemTrend(archives, id)
          .slice(-60)
          .map((point, index) => ({ run: index + 1, ...point })),
      ]),
    ),
    maturity: last
      ? maturityLevels.map((level) => ({
          id: level,
          ...runProvenance(last, current?.ebbVersion),
          scores: maturityCounts(last, level, thresholds.detectors),
        }))
      : [],
    comparison: [
      ...(last
        ? [
            {
              id: "corpus",
              label: "Full corpus",
              ...runProvenance(last, current?.ebbVersion),
              repositories: last.repositories,
              ...(current && Object.keys(current.perEcosystem).length
                ? accuracyCounts(sumCounts(Object.values(current.perEcosystem)))
                : { precision: last.precision, recall: last.recall }),
            },
          ]
        : []),
      ...(heldOut ? [{ id: "held-out", label: "Held-out set", ...summarizeHeldOut(heldOut) }] : []),
    ],
  };
}

function sumCounts(rows: readonly AccuracyCounts[]): AccuracyCounts {
  return rows.reduce(
    (total, row) => ({
      truePositives: total.truePositives + row.truePositives,
      falsePositives: total.falsePositives + row.falsePositives,
      falseNegatives: total.falseNegatives + row.falseNegatives,
    }),
    emptyCounts,
  );
}
