import { readFile } from "node:fs/promises";

import { isIsoDate } from "@velella/ebb/registry";
import * as z from "zod/v4";

import type { SourceLocation } from "../domain.js";
import type { FleetForecast, ForecastRepository } from "./model.js";
import { repositoryKey } from "./model.js";

export class FleetForecastInputError extends Error {}

const name = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/\p{Cc}/u.test(value));
const day = z.string().refine(isIsoDate);
const names = z.array(name);
const captureOwners = names.transform((owners) => [...new Set(owners)].sort());
const repo = z.object({ host: name, repository: name });
const natural = z.int().nonnegative();
const location = z
  .object({
    path: name.refine((path) => !/^(?:[/\\]|[A-Za-z]:)|(?:^|\/)\.\.?(?:\/|$)|\\/u.test(path)),
    line: z.int().positive().optional(),
    column: z.int().positive().optional(),
    jsonPointer: z.string().optional(),
  })
  .transform(
    ({ path, line, column, jsonPointer }): SourceLocation => ({
      path,
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
      ...(jsonPointer === undefined ? {} : { jsonPointer }),
    }),
  );

const observation = z.object({ ruleId: name, location, deadline: day.nullable(), owners: captureOwners });
const evidence = z.object({ findings: z.array(observation), noData: z.array(captureOwners) });
const statusRow = z.object({
  name,
  host: name,
  commit: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    .nullable(),
  status: z.enum(["scanned", "cached", "skipped", "failed"]),
  forecastEvidence: evidence.optional(),
});
const recording = z.object({
  schemaVersion: z.literal("offing.fleet.v1"),
  forecastAsOf: day,
  repositoryStatus: z.array(statusRow),
});
const item = observation.extend(repo.shape).extend({ deadline: day, owners: names.min(1) });
const coverage = z.object({ classified: natural, noData: natural, share: z.number().min(0).max(1).nullable() });
const bucket = z.object({
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  until: day,
  items: z.array(item),
});
const group = z.object({ name, coverage, buckets: z.array(bucket).length(3) });
const previousForecast = z.object({
  schemaVersion: z.literal("offing.fleet-forecast.v1"),
  today: day,
  repositoryCount: natural,
  unavailable: z.array(repo),
  coverage,
  byOwner: z.array(group),
  byRepository: z.array(group.extend({ host: name })),
});

export interface ForecastRecording {
  today: string;
  repositories: ForecastRepository[];
}

export function parseForecastRecording(source: unknown): ForecastRecording {
  const parsed = recording.safeParse(source);
  if (!parsed.success) {
    throw new FleetForecastInputError(
      "Expected an offing.fleet.v1 recording with forecast evidence. Create one with offing fleet <org> --json --forecast-input.",
    );
  }
  const { forecastAsOf: today, repositoryStatus } = parsed.data;
  const seen = new Set<string>();
  const repositories = repositoryStatus.map(({ host, name: repository, status, commit, forecastEvidence }) => {
    const key = repositoryKey(host, repository);
    if (seen.has(key)) throw new FleetForecastInputError("Duplicate repository in the fleet forecast recording.");
    seen.add(key);
    const complete = status === "scanned" || status === "cached";
    if (complete !== Boolean(forecastEvidence) || (complete && commit === null)) {
      throw new FleetForecastInputError("Missing or inconsistent pinned evidence in the fleet forecast recording.");
    }
    return { host, repository, ...(forecastEvidence ? { evidence: forecastEvidence } : {}) };
  });
  return { today, repositories };
}

export async function readForecastJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new FleetForecastInputError(`Cannot read forecast JSON from ${JSON.stringify(file)}.`);
  }
}

export async function readPreviousForecast(file: string): Promise<FleetForecast> {
  const parsed = previousForecast.safeParse(await readForecastJson(file));
  if (!parsed.success)
    throw new FleetForecastInputError("The previous file must be an offing.fleet-forecast.v1 report.");
  return parsed.data;
}
