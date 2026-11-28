import { isIsoDate } from "@velella/ebb/registry";
import * as z from "zod/v4";

import { parseImageReference } from "../detectors/container/parse-image.js";
import type { ScanResult } from "../domain.js";
import { planFixReport } from "../fix/index.js";
import { detectTestPlan } from "../test-runners/detect.js";
import { readRuntimePins, type RuntimePin } from "../upgrade/target-lifecycle.js";
import { repositoryKey } from "../fleet-forecast/model.js";

import {
  type Campaign,
  type CampaignRepository,
  type CampaignState,
  invalidCampaign,
  type Omission,
  type PlannedCheck,
} from "./document.js";

const date = z.string().refine(isIsoDate);
const version = z
  .string()
  .max(30)
  .regex(/^\d+(?:\.\d+){0,2}$/u);
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const host = z
  .string()
  .max(160)
  .regex(
    /^(?:https:\/\/(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]))(?::[0-9]+)?(?:\/[A-Za-z0-9_.%~-]+)*$/u,
  );
const name = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$/u);
const owner = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/\p{Cc}/u.test(value));
const argument = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/\p{Cc}/u.test(value));
const check = z.object({ kind: z.enum(["setup", "install", "build", "test"]), command: z.array(argument).min(1) });
const observation = z.object({ ruleId: id, deadline: date.nullable(), owners: z.array(owner) });

const fleetInput = z.object({
  schemaVersion: z.literal("offing.fleet.v1"),
  forecastAsOf: date.optional(),
  repositoryStatus: z.array(
    z.object({
      host,
      name,
      status: z.enum(["scanned", "cached", "skipped", "failed"]),
      commit: z
        .string()
        .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
        .nullable(),
      forecastEvidence: z.object({ findings: z.array(observation) }).optional(),
      campaignEvidence: z
        .object({
          date,
          runtimePins: z.array(z.object({ runtime: id, version })),
          codemods: z.array(
            z
              .string()
              .max(160)
              .regex(/^[a-z0-9][a-z0-9-]*$/u),
          ),
          checks: z.array(check),
        })
        .optional(),
      whatIfEvidence: z
        .object({
          date,
          targets: z.array(z.object({ runtime: id, version, verdict: z.enum(["ready", "blocked", "unknown"]) })),
        })
        .optional(),
    }),
  ),
});
type FleetRow = z.infer<typeof fleetInput>["repositoryStatus"][number];
type Observation = z.infer<typeof observation>;
type Planned = Pick<CampaignRepository, "host" | "name" | "commit" | "codemods" | "checks"> & {
  findings: Observation[];
};
type Selection = { selected: true } | { selected: false; reason: Omission["reason"] };
const selected: Selection = { selected: true };

function identity({ host, name }: Pick<FleetRow, "host" | "name">): string {
  return repositoryKey(host, name);
}

function listed(repository: FleetRow, entries: readonly string[] = []): boolean {
  return entries.includes(repository.name) || entries.includes(`${repository.host}/${repository.name}`);
}

function matchesUpgrade(campaign: Campaign, row: FleetRow): Selection {
  if (!("upgradeTarget" in campaign.select) || row.whatIfEvidence?.date !== campaign.asOf) {
    return { selected: false, reason: "missing-evidence" };
  }
  const { runtime, version } = campaign.select.upgradeTarget;
  const verdicts = row.whatIfEvidence.targets.filter(
    (target) => target.runtime === runtime && target.version === version,
  );
  const verdict = verdicts.length === 1 ? verdicts[0]?.verdict : undefined;
  if (verdict === "ready") return selected;
  if (verdict === "blocked" || verdict === "unknown") return { selected: false, reason: verdict };
  return { selected: false, reason: "missing-evidence" };
}

function matchesRelease(campaign: Campaign, row: FleetRow): Selection {
  if (!("release" in campaign.select) || row.campaignEvidence?.date !== campaign.asOf) {
    return { selected: false, reason: "missing-evidence" };
  }
  const { product, line } = campaign.select.release;
  const matched = row.campaignEvidence.runtimePins.some(
    (pin) => pin.runtime === product && (pin.version === line || pin.version.startsWith(`${line}.`)),
  );
  return matched ? selected : { selected: false, reason: "no-match" };
}

function select(campaign: Campaign, row: FleetRow, findings: Observation[] | undefined): Selection {
  if (listed(row, campaign.exclude)) return { selected: false, reason: "excluded" };
  if (campaign.include?.length && !listed(row, campaign.include)) return { selected: false, reason: "outside-include" };
  if (row.commit === null || row.status === "failed" || row.status === "skipped") {
    return { selected: false, reason: "not-scanned" };
  }
  if ("upgradeTarget" in campaign.select) return matchesUpgrade(campaign, row);
  if ("release" in campaign.select) return matchesRelease(campaign, row);
  if (findings === undefined) return { selected: false, reason: "missing-evidence" };
  return findings.length > 0 ? selected : { selected: false, reason: "no-match" };
}

const compare = (left: string, right: string): number => (left < right ? -1 : left === right ? 0 : 1);

function ownerDeadlines(repositories: readonly Planned[]): Map<string, string> {
  const deadlines = new Map<string, string>();
  for (const { findings } of repositories) {
    for (const { deadline, owners } of findings) {
      if (deadline === null) continue;
      for (const owner of owners) {
        const previous = deadlines.get(owner);
        if (previous === undefined || deadline < previous) deadlines.set(owner, deadline);
      }
    }
  }
  return deadlines;
}

function ordered(repositories: readonly Planned[], size: number): CampaignRepository[] {
  const deadlines = ownerDeadlines(repositories);
  return repositories
    .map(({ findings, ...repository }) => {
      const owners = [...new Set(findings.flatMap((entry) => entry.owners))].sort();
      const deadline = findings.flatMap((entry) => (entry.deadline === null ? [] : [entry.deadline])).sort()[0] ?? null;
      const priority = owners.flatMap((owner) => deadlines.get(owner) ?? []).sort()[0] ?? deadline ?? "";
      return { repository, owners, deadline, priority };
    })
    .sort(
      (a, b) =>
        compare(a.priority || "9999-99-99", b.priority || "9999-99-99") ||
        compare(identity(a.repository), identity(b.repository)),
    )
    .map(({ repository, owners, deadline }, index) => ({
      ...repository,
      owners,
      deadline,
      batch: Math.floor(index / size) + 1,
      status: "queued",
      transitions: [],
    }));
}

function observations(campaign: Campaign, row: FleetRow, forecastAsOf: string | undefined): Observation[] | undefined {
  if (forecastAsOf !== campaign.asOf) return undefined;
  const findings = row.forecastEvidence?.findings;
  const selection = campaign.select;
  return "ruleId" in selection ? findings?.filter(({ ruleId }) => ruleId === selection.ruleId) : findings;
}

function stateMetadata(campaign: Campaign) {
  const target = "upgradeTarget" in campaign.select ? campaign.select.upgradeTarget : campaign.target;
  return { id: campaign.id, asOf: campaign.asOf, batching: campaign.batching, ...(target ? { target } : {}) };
}

export function planCampaign(campaign: Campaign, input: unknown): CampaignState {
  const parsed = fleetInput.safeParse(input);
  if (!parsed.success) throw invalidCampaign("Expected an offing.fleet.v1 input with valid repository evidence.");
  const seen = new Set<string>();
  const repositories: Planned[] = [];
  const omissions: Omission[] = [];
  const { repositoryStatus, forecastAsOf } = parsed.data;
  for (const row of repositoryStatus) {
    const key = identity(row);
    if (seen.has(key)) throw invalidCampaign("Fleet input repeats a repository.");
    seen.add(key);
    const { host, name, commit, campaignEvidence } = row;
    const findings = observations(campaign, row, forecastAsOf);
    const verdict = select(campaign, row, findings);
    if (!verdict.selected) {
      omissions.push({ host, name, reason: verdict.reason });
      continue;
    }
    if (commit === null) throw invalidCampaign("Selected repository is missing its commit.");
    const evidence = campaignEvidence?.date === campaign.asOf ? campaignEvidence : undefined;
    repositories.push({
      host,
      name,
      commit,
      findings: findings ?? [],
      codemods: evidence ? [...new Set(evidence.codemods)].sort() : null,
      checks: evidence?.checks ?? null,
    });
  }
  return {
    schemaVersion: "offing.campaign-state.v1",
    ...stateMetadata(campaign),
    repositories: ordered(repositories, campaign.batching.size),
    omissions: omissions.sort((a, b) => compare(identity(a), identity(b))),
  };
}

export interface CampaignEvidence {
  date: string;
  runtimePins: { runtime: string; version: string }[];
  codemods: string[];
  checks: PlannedCheck[];
}

export const campaignInputPaths = [
  "requirements.txt",
  "pytest.ini",
  ".pytest.ini",
  "mvnw",
  "mvnw.cmd",
  "gradlew",
  "gradlew.bat",
] as const;

/** Keep the declared precision. A major-only pin cannot establish a particular minor line. */
function exactVersion({ field, value }: RuntimePin): string | undefined {
  const literal = field === "FROM" ? (parseImageReference(value)?.tag?.split("-", 1)[0] ?? "") : value;
  return /^v?((?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,2})$/u.exec(literal)?.[1];
}

export async function captureCampaignEvidence(report: ScanResult, date: string): Promise<CampaignEvidence> {
  const [pins, repairs, checks] = await Promise.all([
    readRuntimePins(report.root),
    planFixReport(report),
    detectTestPlan(report.root),
  ]);
  const observed = pins.flatMap((pin) => {
    const version = exactVersion(pin);
    return version === undefined ? [] : [`${pin.runtime}@${version}`];
  });
  const runtimePins = [...new Set(observed)].sort().flatMap((pin) => {
    const [runtime, version] = pin.split("@");
    return runtime && version ? [{ runtime, version }] : [];
  });
  return {
    date,
    runtimePins,
    codemods: [...new Set(repairs.patches.map(({ fixer }) => fixer))].sort(),
    checks: checks.steps
      .filter(({ command }) => command.every((argument) => argument.length <= 512 && !/\p{Cc}/u.test(argument)))
      .map(({ kind, command }) => ({ kind, command })),
  };
}
