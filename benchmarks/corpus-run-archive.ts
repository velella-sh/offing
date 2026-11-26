import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ReportableResult } from "./corpus-report.js";
import { scoreEcosystems } from "./corpus-report.js";
import type { FullRunRecord } from "./thresholds.js";

export const CORPUS_RUNS_DIR = "benchmarks/corpus-runs";

export interface AccuracyCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface AccuracyMiss {
  repository: string;
  commit: string;
  finding: string;
  kind: "missing" | "unexpected";
}

export interface ArchivedCorpusRun extends FullRunRecord {
  ebbVersion: string;
  perEcosystem: Record<string, AccuracyCounts & { repositories: number; misses: AccuracyMiss[] }>;
}

export function archiveCorpusRun(
  record: FullRunRecord,
  ebbVersion: string,
  rows: readonly ReportableResult[],
): ArchivedCorpusRun {
  if (rows.length !== record.repositories || rows.some((row) => row.error !== undefined)) {
    throw new Error("A corpus archive requires every recorded repository to have been scored.");
  }
  const grouped = new Map<string, ReportableResult[]>();
  for (const row of rows) {
    const group = grouped.get(row.ecosystem) ?? [];
    group.push(row);
    grouped.set(row.ecosystem, group);
  }
  const perEcosystem = Object.fromEntries(
    scoreEcosystems(rows).map(({ name, precision: _precision, ...counts }) => {
      const group = grouped.get(name) ?? [];
      return [
        name,
        {
          ...counts,
          repositories: group.length,
          misses: group.flatMap(({ repository, commit, missing, unexpected }) =>
            [
              ...missing.map((finding) => ({ finding, kind: "missing" as const })),
              ...unexpected.map((finding) => ({ finding, kind: "unexpected" as const })),
            ].map((miss) => ({ repository, commit, ...miss })),
          ),
        },
      ];
    }),
  );
  return { ...record, ebbVersion, perEcosystem };
}

export async function writeCorpusArchive(root: string, record: ArchivedCorpusRun): Promise<void> {
  const dir = resolve(root, CORPUS_RUNS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${record.date}-${record.commit}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

export async function readCorpusArchive(root: string): Promise<ArchivedCorpusRun[]> {
  const dir = resolve(root, CORPUS_RUNS_DIR);
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(
    files
      .filter((file) => /^\d{4}-\d{2}-\d{2}-[a-f0-9]{7,40}\.json$/.test(file))
      .sort()
      .map(async (file) => JSON.parse(await readFile(resolve(dir, file), "utf8")) as ArchivedCorpusRun),
  );
}
