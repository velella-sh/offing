import { readFile } from "node:fs/promises";

import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isIsoDate } from "@velella/ebb/registry";
import { parseDocument } from "yaml";

import { repositoryKey } from "../fleet-forecast/model.js";
import { OffingError } from "../offing-error.js";
import { findPackageFile } from "../package-files.js";
import { readRunnerText } from "../test-runners/files.js";
import type { UpgradeTarget } from "../upgrade/index.js";

export interface Batching {
  size: number;
  concurrency: number;
  minGapMinutes: number;
  maxFailureRate: number;
}

export type Selector =
  | { ruleId: string }
  | { release: { product: string; line: string } }
  | { upgradeTarget: UpgradeTarget };

export interface Campaign {
  schemaVersion: "offing.campaign.v1";
  id: string;
  asOf: string;
  select: Selector;
  include?: string[];
  exclude?: string[];
  batching: Batching;
  target?: UpgradeTarget;
}

type RepositoryStatus = "queued" | "running" | "verified" | "review" | "merged" | "closed" | "failed" | "cancelled";

export interface PlannedCheck {
  kind: "setup" | "install" | "build" | "test";
  command: string[];
}

export interface CampaignRepository {
  host: string;
  name: string;
  commit: string;
  batch: number;
  owners: string[];
  deadline: string | null;
  codemods: string[] | null;
  checks: PlannedCheck[] | null;
  status: RepositoryStatus;
  transitions: { from: RepositoryStatus; to: RepositoryStatus; at: string }[];
}

export interface Omission {
  host: string;
  name: string;
  reason: "excluded" | "outside-include" | "not-scanned" | "missing-evidence" | "no-match" | "blocked" | "unknown";
}

export interface CampaignState {
  schemaVersion: "offing.campaign-state.v1";
  id: string;
  asOf: string;
  batching: Batching;
  target?: UpgradeTarget;
  repositories: CampaignRepository[];
  omissions: Omission[];
}

export function invalidCampaign(message: string): OffingError {
  return new OffingError("invalid-argument", message);
}

function isCanonicalTime(value: string): boolean {
  const instant = new Date(value);
  return value.length === 24 && Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

async function validator<T>(file: string): Promise<ValidateFunction<T>> {
  const path = await findPackageFile(`schemas/${file}.v1.schema.json`, import.meta.url);
  const schema: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("Expected a packaged campaign schema.");
  }
  return new Ajv2020({ ownProperties: true })
    .addFormat("date", isIsoDate)
    .addFormat("date-time", isCanonicalTime)
    .compile<T>(schema);
}

let campaignValidator: Promise<ValidateFunction<Campaign>> | undefined;
let stateValidator: Promise<ValidateFunction<CampaignState>> | undefined;

function checked<T>(value: unknown, check: ValidateFunction<T>, label: string): T {
  if (check(value)) return value;
  const issue = check.errors?.[0];
  throw invalidCampaign(`Invalid ${label} at ${issue?.instancePath || "/"}: ${issue?.message ?? "invalid document"}.`);
}

async function readInput(file: string, yaml: boolean): Promise<unknown> {
  const text = await readRunnerText(file, 32 * 1024 * 1024);
  if (text === undefined) throw invalidCampaign("Expected a readable, regular campaign input up to 32 MiB.");
  try {
    if (!yaml) return JSON.parse(text);
    const document = parseDocument(text, { prettyErrors: false });
    if (document.errors.length !== 0 || document.warnings.length !== 0) throw new Error("Invalid YAML.");
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    throw invalidCampaign(
      yaml ? "Expected a campaign file in YAML or JSON without aliases." : "Expected a JSON input.",
    );
  }
}

function checkBatching(batching: Batching): void {
  if (batching.concurrency > batching.size) throw invalidCampaign("Campaign concurrency exceeds its batch size.");
}

function checkHistory(repository: CampaignRepository): void {
  let status: RepositoryStatus = "queued";
  let previous = "";
  for (const entry of repository.transitions) {
    if (entry.from !== status) throw invalidCampaign("Campaign state has a discontinuous repository history.");
    if (entry.at < previous) throw invalidCampaign("Campaign state history timestamps must be nondecreasing.");
    status = entry.to;
    previous = entry.at;
  }
  if (status !== repository.status) throw invalidCampaign("Campaign state status does not match its history.");
}

export async function readCampaign(file: string): Promise<Campaign> {
  const document = checked(
    await readInput(file, true),
    await (campaignValidator ??= validator("campaign")),
    "campaign",
  );
  checkBatching(document.batching);
  if ("upgradeTarget" in document.select && document.target) {
    const { runtime, version } = document.select.upgradeTarget;
    if (document.target.runtime !== runtime || document.target.version !== version) {
      throw invalidCampaign("Campaign target differs from its upgrade selector.");
    }
  }
  return document;
}

export async function readCampaignState(file: string): Promise<CampaignState> {
  const state = checked(
    await readInput(file, false),
    await (stateValidator ??= validator("campaign-state")),
    "campaign state",
  );
  if ("more" in state) throw invalidCampaign("Campaign state must contain the complete saved document.");
  checkBatching(state.batching);
  const identities = new Set<string>();
  for (const [index, row] of state.repositories.entries()) {
    const identity = repositoryKey(row.host, row.name);
    if (identities.has(identity)) throw invalidCampaign("Campaign state repeats a repository.");
    identities.add(identity);
    if (row.batch !== Math.floor(index / state.batching.size) + 1) {
      throw invalidCampaign("Campaign state has an inconsistent batch assignment.");
    }
    checkHistory(row);
  }
  for (const row of state.omissions) {
    const identity = repositoryKey(row.host, row.name);
    if (identities.has(identity)) throw invalidCampaign("Campaign state repeats a repository.");
    identities.add(identity);
  }
  return state;
}

export function readCampaignFleet(file: string): Promise<unknown> {
  return readInput(file, false);
}
