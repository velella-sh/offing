import { isIsoDate } from "@velella/ebb/registry";
import * as z from "zod/v4";
import { OffingError } from "../offing-error.js";
import type { UpgradeTarget } from "../upgrade/types.js";
import type { RepositorySimulation, TargetSimulation } from "./index.js";

const targetFields = { runtime: z.string().min(1), version: z.string().min(1) };
const verdict = z.enum(["ready", "blocked", "unknown"]);
const targetEvidence = z.object({ ...targetFields, verdict, reason: z.string().min(1) });
const capture = z.object({
  date: z.string().refine(isIsoDate),
  targets: z.array(targetEvidence).max(8),
});
const repository = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  commit: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    .nullable(),
  status: z.enum(["scanned", "cached", "skipped", "failed"]),
  reason: z.string().nullable(),
  whatIfEvidence: capture.optional(),
});
const recording = z.object({
  schemaVersion: z.literal("offing.fleet.v1"),
  repositoryStatus: z.array(repository),
});

export type FleetWhatIfEvidence = z.infer<typeof capture>;

function captureReason(report: TargetSimulation): string {
  if (report.support.status === "ended") return "The requested runtime line has ended.";
  if (report.verdict === "ready") return "The applicable static compatibility checks found no blocker or unknown.";
  const issue = report.issues.find(({ level }) => level === (report.verdict === "blocked" ? "blocker" : "unknown"));
  return issue
    ? `${issue.path} — ${issue.reason}`
    : "No compatibility analyzer supplied evidence for this repository and target.";
}

/** Capture only a verdict and reason. The source tree and projected file evidence remain private to the scan. */
export function captureWhatIf(report: RepositorySimulation): FleetWhatIfEvidence {
  return {
    date: report.today,
    targets: report.reports.map((item) => ({
      ...item.target,
      verdict: item.verdict,
      reason: captureReason(item),
    })),
  };
}

function evidenceFor(row: z.infer<typeof repository>, target: UpgradeTarget, today: string) {
  if (!row.commit || (row.status !== "scanned" && row.status !== "cached")) return undefined;
  if (row.whatIfEvidence?.date !== today) return undefined;
  const matches = row.whatIfEvidence.targets.filter(
    ({ runtime, version }) => runtime === target.runtime && version === target.version,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

interface FleetEntry {
  host: string;
  name: string;
  commit: string | null;
  reason: string;
}

export function simulateFleet(record: unknown, targets: readonly UpgradeTarget[], asOf?: string) {
  const parsed = recording.safeParse(record);
  if (!parsed.success) throw new OffingError("invalid-argument", "Expected a saved offing.fleet.v1 result.");
  const repositories = parsed.data.repositoryStatus;
  const dates = new Set(repositories.flatMap(({ whatIfEvidence }) => (whatIfEvidence ? [whatIfEvidence.date] : [])));
  const today = asOf ?? (dates.size === 1 ? [...dates][0] : undefined) ?? new Date().toISOString().slice(0, 10);
  if (!isIsoDate(today)) throw new OffingError("invalid-argument", "Use a valid --as-of date (YYYY-MM-DD).");
  const ids = new Set(repositories.map(({ host, name }) => JSON.stringify([host, name])));
  if (ids.size !== repositories.length)
    throw new OffingError("invalid-argument", "Duplicate repository in the fleet result.");

  const reports = targets.map((target) => {
    const ready: FleetEntry[] = [];
    const blocked: FleetEntry[] = [];
    const unknown: FleetEntry[] = [];
    for (const row of repositories) {
      const evidence = dates.size > 1 && asOf === undefined ? undefined : evidenceFor(row, target, today);
      const entry = {
        name: row.name,
        host: row.host,
        commit: row.commit,
        reason:
          evidence?.reason ?? row.reason ?? "No pinned compatibility evidence was recorded for this target and day.",
      };
      ({ ready, blocked, unknown })[evidence?.verdict ?? "unknown"].push(entry);
    }
    return { target, ready, blocked, unknown };
  });
  return { schemaVersion: "offing.whatif.v1" as const, kind: "fleet" as const, today, reports };
}

export type FleetSimulation = ReturnType<typeof simulateFleet>;
