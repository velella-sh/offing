import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { configureActiveData, getActiveData } from "@velella/ebb/data-source";
import { isIsoDate } from "@velella/ebb/registry";
import { z } from "zod";
import { lifecycleRules } from "../../src/sbom/lifecycle.js";
import type { Cohort } from "./cohort.js";
import type { StudyCapture } from "./capture.js";
import { resolveStudyLineage, type StudyLineage } from "./lineage.js";
import { measuredRows } from "./metrics.js";
import { publicStudyCapture, publicStudyLineage } from "./public-evidence.js";

const sha = z.string().regex(/^[\da-f]{40}$/);
const hash = z.string().regex(/^[\da-f]{64}$/);
const count = z.number().int().nonnegative();
const date = z.string().refine(isIsoDate);
const text = z.string().min(1);
const versions = z.object({ version: text, digest: z.string().nullable() });
const timestamp = z.iso.datetime();
const graphBlocker = z.object({ subject: text, path: text });
const lifecycleEvent = z.enum(["deprecated", "end-of-support", "end-of-life", "removed", "scheduled-end-of-life"]);
const planSchema = z.object({
  schemaVersion: z.literal("offing.state-of-eol.scan.v1"),
  cohortDigest: hash,
  sourceCommit: sha,
  offing: text,
  data: versions,
  packageLockDigest: hash,
  node: text,
  platform: text,
  asOf: date,
  startedAt: timestamp,
  start: count,
  end: count,
  jobs: count,
});

const captureBoundary = z.object({
  findings: z.array(
    z.object({
      ruleId: text,
      detector: text,
      deadline: date.nullable(),
      event: lifecycleEvent.nullable(),
      purl: text.nullable(),
      location: z.object({ path: text }),
    }),
  ),
  coverage: z
    .object({
      ecosystems: z.array(text),
      filesRead: z.array(text),
      unsupportedFiles: z.array(text),
      truncated: z.boolean().optional(),
    })
    .nullable(),
  scannerDiagnostics: count,
  noData: z.record(text, count),
  actions: z.array(z.object({ path: text, runtimes: z.array(text) })),
  upgrade: z
    .array(
      z.discriminatedUnion("status", [
        z.object({
          status: z.literal("scanned"),
          report: z.object({
            target: z.object({ runtime: text, version: text }),
            verdict: z.enum(["ready", "blocked", "unknown"]),
            analyzers: z.array(text),
            issues: z.array(
              z.object({
                analyzer: text,
                level: z.enum(["blocker", "warning", "unknown"]),
                subject: text,
                path: text,
                evidence: z.object({ kind: z.enum(["lockfile", "manifest", "rule"]), value: z.string() }),
              }),
            ),
            graph: z.object({
              total: count,
              roots: z.array(z.object({ blockers: z.array(graphBlocker) })),
              ungrouped: z.array(graphBlocker),
            }),
          }),
        }),
        z.object({ status: z.literal("failed"), target: z.object({ runtime: text, version: text }) }),
      ]),
    )
    .length(2),
  lineage: z
    .object({
      documents: z.array(z.unknown()),
      builds: z.array(z.unknown()),
      repository: z.object({ host: z.literal("https://github.com"), name: text, commit: sha }),
    })
    .nullable(),
});

const rowSchema = z.object({
  rank: z.number().int().positive(),
  repository: text,
  commit: sha,
  state: z.object({
    name: text,
    host: z.literal("https://github.com"),
    defaultBranch: text.nullable(),
    commit: sha.nullable(),
    status: z.enum(["scanned", "cached", "failed", "skipped"]),
    reason: text.nullable(),
    bytesFetched: count,
  }),
  capture: z.custom<StudyCapture>((value) => captureBoundary.safeParse(value).success).optional(),
});

const retrySchema = z.object({
  rank: rowSchema.shape.rank,
  scanIndex: count,
  status: z.enum(["scanned", "failed", "skipped"]),
  reason: rowSchema.shape.state.shape.reason,
  bytesFetched: count,
});

const archiveInput = z.object({
  schemaVersion: z.literal("offing.state-of-eol.evidence.v1"),
  scans: z.array(z.object({ plan: planSchema, finishedAt: timestamp.nullable() })).min(1),
  rows: z.array(rowSchema).max(1000),
  retries: z.array(retrySchema).default([]),
});

const lineageBoundary = z.object({
  files: z.array(z.object({ repository: text, path: text, direct: z.boolean(), stageCount: count })),
  chains: z.array(
    z.object({
      repository: text,
      path: text,
      truncated: z.boolean().optional(),
      links: z.array(
        z.object({
          relationship: z.enum(["from", "copy", "image", "os"]),
          parents: z.array(count),
          status: text,
          deadline: date.optional(),
          ruleId: text.optional(),
        }),
      ),
    }),
  ),
});

const archiveSchema = archiveInput.extend({
  lineage: z.custom<StudyLineage>((value) => lineageBoundary.safeParse(value).success),
  rules: z.array(z.object({ id: text, event: lifecycleEvent, purl: text, deadline: date.nullable() })),
});

export type StudyArchive = z.infer<typeof archiveSchema>;
export type StudyObservation = z.infer<typeof rowSchema>;
const maximumUncompressedBytes = 256 * 1024 * 1024;
const maximumArchiveBytes = 40 * 1024 * 1024;

function parse(text: string): unknown {
  return JSON.parse(text);
}

type ArchiveInput = z.infer<typeof archiveInput>;

function verifyRetries(archive: ArchiveInput): void {
  const rows = new Map(archive.rows.map((row) => [row.rank, row]));
  const groups = new Map<number, ArchiveInput["retries"]>();
  for (const attempt of archive.retries) {
    const group = groups.get(attempt.rank) ?? [];
    const plan = archive.scans[attempt.scanIndex]?.plan;
    if (!plan || !rows.has(attempt.rank) || attempt.rank < plan.start || attempt.rank > plan.end)
      throw new Error(`The retry evidence does not match cohort rank ${attempt.rank}.`);
    if (group.some(({ scanIndex }) => scanIndex >= attempt.scanIndex))
      throw new Error(`Repeated or out-of-order retry evidence for rank ${attempt.rank}.`);
    group.push(attempt);
    groups.set(attempt.rank, group);
  }
  for (const [rank, group] of groups) {
    const success = group.filter(({ status }) => status === "scanned");
    const selected = success[0] ?? group[0];
    const state = rows.get(rank)?.state;
    if (!selected || !state || group.length < 2 || group[0]?.status === "scanned" || success.length > 1)
      throw new Error(`Invalid retry history for rank ${rank}.`);
    if (
      selected.status !== state.status ||
      selected.reason !== state.reason ||
      selected.bytesFetched !== state.bytesFetched
    )
      throw new Error(`Selected observation does not match retry evidence for rank ${rank}.`);
  }
}

function verifyArchive<T extends z.infer<typeof archiveInput>>(archive: T, cohort: Cohort, cohortDigest: string): T {
  const first = archive.scans[0]?.plan;
  for (const { plan, finishedAt } of archive.scans) {
    if (
      plan.cohortDigest !== cohortDigest ||
      plan.asOf !== cohort.retrievedAt.slice(0, 10) ||
      plan.sourceCommit !== first?.sourceCommit ||
      plan.packageLockDigest !== first.packageLockDigest ||
      plan.data.version !== first.data.version ||
      plan.data.digest !== first.data.digest ||
      plan.offing !== first.offing ||
      plan.node !== first.node ||
      plan.platform !== first.platform ||
      plan.start < 1 ||
      plan.end < plan.start ||
      plan.end > cohort.repositories.length ||
      (finishedAt !== null && finishedAt < plan.startedAt)
    )
      throw new Error("The evidence has incompatible scan provenance.");
  }
  let previous = 0;
  for (const row of archive.rows) {
    const pin = cohort.repositories[row.rank - 1];
    if (
      !pin ||
      row.rank <= previous ||
      pin.repository !== row.repository ||
      pin.commit !== row.commit ||
      row.state.name !== row.repository ||
      row.state.commit !== row.commit ||
      row.state.defaultBranch !== pin.branch ||
      (row.state.status === "scanned") !== Boolean(row.capture) ||
      row.state.status === "cached" ||
      !archive.scans.some(({ plan }) => row.rank >= plan.start && row.rank <= plan.end)
    ) {
      throw new Error(`The evidence does not match cohort rank ${row.rank}.`);
    }
    previous = row.rank;
  }
  verifyRetries(archive);
  return archive;
}

export async function loadStudyArchive(path: string, cohort: Cohort, cohortDigest: string): Promise<StudyArchive> {
  if ((await stat(path)).size > maximumArchiveBytes) throw new Error("Study archive exceeds 40 MiB.");
  const text = gunzipSync(await readFile(path), { maxOutputLength: maximumUncompressedBytes }).toString("utf8");
  return verifyArchive(archiveSchema.parse(parse(text)), cohort, cohortDigest);
}

export async function freezeStudyArchive(
  directories: readonly string[],
  out: string,
  cohort: Cohort,
  cohortDigest: string,
): Promise<void> {
  const scans: StudyArchive["scans"] = [];
  const rows = new Map<number, StudyObservation>();
  const attempts = new Map<number, StudyArchive["retries"]>();
  for (const directory of directories) {
    const plan = planSchema.parse(parse(await readFile(join(directory, "plan.json"), "utf8")));
    const finished = await readFile(join(directory, "finished.json"), "utf8").catch(() => undefined);
    const finishedAt = finished ? z.object({ finishedAt: timestamp }).parse(parse(finished)).finishedAt : null;
    const scanIndex = scans.push({ plan, finishedAt }) - 1;
    for (const file of (await readdir(directory)).filter((name) => /^\d{4}\.json$/.test(name)).sort()) {
      const row = rowSchema.parse(parse(await readFile(join(directory, file), "utf8")));
      const earlier = rows.get(row.rank);
      if (row.rank < plan.start || row.rank > plan.end || earlier?.capture) {
        throw new Error(`Conflicting scan evidence for rank ${row.rank}.`);
      }
      const { status, reason, bytesFetched } = row.state;
      const history = attempts.get(row.rank) ?? [];
      history.push(retrySchema.parse({ rank: row.rank, scanIndex, status, reason, bytesFetched }));
      attempts.set(row.rank, history);
      if (!earlier || row.capture) rows.set(row.rank, row);
    }
  }
  const archive = verifyArchive(
    {
      schemaVersion: "offing.state-of-eol.evidence.v1",
      scans,
      rows: [...rows.values()].sort((a, b) => a.rank - b.rank),
      retries: [...attempts.values()].filter((history) => history.length > 1).flat(),
    },
    cohort,
    cohortDigest,
  );
  const plan = scans[0]?.plan;
  if (!plan) throw new Error("Study evidence needs at least one scan.");
  configureActiveData({ pinnedVersion: "bundled" });
  const { info } = await getActiveData();
  if (info.version !== plan.data.version || info.contentDigest !== plan.data.digest) {
    throw new Error(`Use bundled Ebb ${plan.data.version} to resolve lineage at acquisition time.`);
  }
  const [lineage, catalog] = await Promise.all([
    resolveStudyLineage(measuredRows(archive.rows), plan.asOf),
    lifecycleRules(),
  ]);
  const rules = catalog.map(({ id, event, purl, deadline }) => ({ id, event, purl, deadline: deadline ?? null }));
  const publicRows = archive.rows.map((row) =>
    row.capture ? { ...row, capture: publicStudyCapture(row.capture) } : row,
  );
  const data = Buffer.from(
    `${JSON.stringify({ ...archive, rows: publicRows, lineage: publicStudyLineage(lineage), rules })}\n`,
  );
  if (data.length > maximumUncompressedBytes) throw new Error("Study evidence exceeds the archive size bound.");
  const compressed = gzipSync(data, { level: 9 });
  if (compressed.length > maximumArchiveBytes) throw new Error("Study archive exceeds 40 MiB.");
  await writeFile(out, compressed, { flag: "wx" });
}

export const evidenceDigest = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
