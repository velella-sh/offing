import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { evidenceDigest, freezeStudyArchive, loadStudyArchive, type StudyArchive } from "./archive.js";
import { readCohort } from "./cohort.js";
import { imageBreakdown } from "./lineage.js";
import {
  actionBreakdown,
  attachRuleCatalog,
  coverageCounts,
  ecosystemBreakdown,
  headlines,
  measuredRows,
  upgradeBreakdown,
} from "./metrics.js";
import { defaultCohort } from "./scan.js";

export const defaultArchive = "benchmarks/state-of-eol/2027-raw.json.gz";
const dataDirectory = "docs/_data";
const reportId = "state-of-eol-2027";
const stringify = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const divide = (value: number, denominator: number) =>
  denominator === 0 ? "Unavailable" : `${value}/${denominator} (${((100 * value) / denominator).toFixed(1)}%)`;

export function evaluateStudy(archive: StudyArchive, cohort: number) {
  const plan = archive.scans[0]?.plan;
  if (!plan) throw new Error("The study has no scan metadata.");
  const rows = attachRuleCatalog(measuredRows(archive.rows), archive.rules);
  return {
    schemaVersion: "offing.state-of-eol.report.v1",
    asOf: plan.asOf,
    scanStarted: plan.startedAt,
    scanFinished: archive.scans.reduce<string | null>(
      (latest, { finishedAt }) => (finishedAt && (latest === null || finishedAt > latest) ? finishedAt : latest),
      null,
    ),
    provenance: archive.scans,
    coverage: coverageCounts(archive, cohort),
    headlines: headlines(rows, cohort, plan.asOf),
    ecosystems: ecosystemBreakdown(rows, cohort),
    actions: actionBreakdown(rows, cohort),
    upgrades: upgradeBreakdown(rows, cohort),
    lineage: imageBreakdown(
      archive.lineage,
      cohort - rows.filter(({ capture }) => capture.lineage !== null).length,
      plan.asOf,
    ),
    predictions: { status: "unavailable", denominator: cohort, noData: null, unknown: cohort },
  };
}

type Report = Awaited<ReturnType<typeof evaluateStudy>>;

function headlineRows(report: Report) {
  const { ended, median, common } = report.headlines;
  const { cohort } = report.coverage;
  return [
    {
      id: "ended-runtime",
      label: "Repositories with an ended runtime",
      result: divide(ended.count, ended.denominator),
      denominator: ended.denominator,
      noData: divide(ended.noData, cohort),
      unknown: divide(ended.unknown, cohort),
      scannedWithoutEvent: "—",
    },
    {
      id: "days-to-next",
      label: "Median days to the next dated support event",
      result: median.days ?? "Unavailable",
      denominator: median.denominator,
      noData: divide(median.noData, cohort),
      unknown: divide(median.unknown, cohort),
      scannedWithoutEvent: divide(median.scannedWithoutEvent, cohort),
    },
    {
      id: "leading-item",
      label: "Most common upcoming rule",
      result: common.rule ? `${common.rule} (${common.count} repositories)` : "Unavailable",
      denominator: common.denominator,
      noData: divide(common.noData, cohort),
      unknown: divide(common.unknown, cohort),
      scannedWithoutEvent: divide(common.scannedWithoutEvent, cohort),
    },
    {
      id: "predictions",
      label: "Predicted end-of-life lines",
      result: "Unavailable",
      denominator: cohort,
      noData: "Unmeasured",
      unknown: divide(report.predictions.unknown, cohort),
      scannedWithoutEvent: "—",
    },
  ];
}

function documentationRecord(report: Report, rawDigest: string) {
  const plan = report.provenance[0]?.plan;
  return [
    {
      id: reportId,
      asOf: report.asOf,
      until: report.headlines.until,
      scanStarted: report.scanStarted,
      scanFinished: report.scanFinished ?? "Unfinished",
      scanner: plan
        ? `[${plan.sourceCommit}](https://github.com/velella-sh/offing/commit/${plan.sourceCommit})`
        : "Unavailable",
      ebb: plan?.data.version ?? "Unavailable",
      rawDigest,
      ...report.coverage,
      lineage: divide(report.lineage.lineageOnly, report.lineage.denominator),
      lineageNoData: divide(report.lineage.noData, report.lineage.denominator),
      lineageUnknown: divide(report.lineage.unknown, report.lineage.denominator),
      lineageUnavailable: report.lineage.unavailableRepositories,
    },
  ];
}

function collectionSources(report: Report, rawDigest: string) {
  const { cohort } = report.coverage;
  const ecosystems = report.ecosystems.map(({ unknown, noData, ...row }) => ({
    ...row,
    noData: divide(noData, row.denominator),
    unknown: divide(unknown, cohort),
  }));
  const actions = report.actions.map(({ id, unknown, noData, ...row }, index) => ({
    ...row,
    id: `runtime-${index + 1}`,
    runtime: id,
    noData: divide(noData, row.denominator),
    unknown: divide(unknown, cohort),
  }));
  const blockers = report.upgrades.flatMap(({ id, denominator, noData, unknown, packages }, targetIndex) =>
    packages.slice(0, 25).map(([packageName, affected], packageIndex) => ({
      id: `target-${targetIndex + 1}-package-${packageIndex + 1}`,
      target: id,
      packageName,
      affected,
      denominator,
      noData: divide(noData, cohort),
      unknown: divide(unknown, cohort),
    })),
  );
  return {
    [`${reportId}.json`]: stringify({ ...report, rawDigest }),
    [`${reportId}-run.json`]: stringify(documentationRecord(report, rawDigest)),
    [`${reportId}-headlines.json`]: stringify(headlineRows(report)),
    [`${reportId}-ecosystems.json`]: stringify(ecosystems),
    [`${reportId}-actions.json`]: stringify(actions),
    [`${reportId}-blockers.json`]: stringify(blockers),
    [`${reportId}-upgrade-coverage.json`]: stringify(
      report.upgrades.map(({ id, packages, ...target }, index) => ({
        ...target,
        id: `target-${index + 1}`,
        target: id,
        packages: packages.length,
        noData: divide(target.noData, cohort),
        unknown: divide(target.unknown, cohort),
      })),
    ),
  };
}

export async function renderStudyCollections(root: string, archivePath = resolve(root, defaultArchive)) {
  const cohortPath = resolve(root, defaultCohort);
  const cohort = await readCohort(cohortPath);
  const archive = await loadStudyArchive(archivePath, cohort, evidenceDigest(await readFile(cohortPath)));
  const report = evaluateStudy(archive, cohort.repositories.length);
  return collectionSources(report, evidenceDigest(await readFile(archivePath)));
}

async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      archive: { type: "string", default: defaultArchive },
      scan: { type: "string", multiple: true },
      out: { type: "string", default: dataDirectory },
    },
  });
  if (values.scan) {
    const cohort = await readCohort(defaultCohort);
    await freezeStudyArchive(values.scan, values.archive, cohort, evidenceDigest(await readFile(defaultCohort)));
  }
  const sources = await renderStudyCollections(".", resolve(values.archive));
  await mkdir(values.out, { recursive: true });
  await Promise.all(Object.entries(sources).map(([file, contents]) => writeFile(join(values.out, file), contents)));
  process.stdout.write(
    `acc-state-of-eol: produced ${Object.keys(sources).length} collections from ${values.archive}.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
