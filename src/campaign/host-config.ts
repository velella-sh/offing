import * as z from "zod/v4";

import { readJsonFile } from "../agent-drivers/result.js";
import { gitlabBase, validRepositoryPath } from "../fleet/remote.js";
import { repositoryKey } from "../fleet-forecast/model.js";
import { type CampaignRepository, type CampaignState, invalidCampaign } from "./document.js";

const tokenName = /^OFFING_CAMPAIGN_TOKEN_[A-Z0-9_]+$/u;
const branchName =
  /^(?!.*\.\.)(?!.*(?:\.lock|\.)($|\/))[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/u;
const token = z.string().max(128).regex(tokenName);
const actor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const permission = z.strictObject({
  host: z.string().max(160),
  name: z.string().max(512).refine(validRepositoryPath),
  baseBranch: z.string().max(255).regex(branchName),
  tokenEnv: token,
  actorId: actor,
});
const operationsPermission = z.strictObject({
  campaign: z.string(),
  repository: z
    .string()
    .max(512)
    .refine((value) => validRepositoryPath(value) && value.split("/").length === 2),
  tokenEnv: token,
  actorId: actor,
});
const document = z.strictObject({
  campaign: z.string(),
  repositories: z.array(permission).min(1).max(1000),
});

export type HostPermissions = z.infer<typeof document>;

export function campaignTokenNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) => tokenName.test(key.toUpperCase()));
}

export async function readHostPermissions(file: string): Promise<HostPermissions> {
  const parsed = document.safeParse(await readJsonFile(file, 1024 * 1024).catch(() => undefined));
  if (!parsed.success)
    throw invalidCampaign("Expected campaign host permissions with an exact repository, base branch and token name.");
  return parsed.data;
}

export async function readOperationsPermission(file: string) {
  const parsed = operationsPermission.safeParse(await readJsonFile(file, 1024 * 1024).catch(() => undefined));
  if (!parsed.success)
    throw invalidCampaign("Expected a campaign, GitHub operations repository, actor and token name.");
  return parsed.data;
}

export function campaignCredential(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.length > 1024 || !/^[\x21-\x7e]+$/u.test(value)) {
    throw invalidCampaign("A configured campaign host token is unavailable.");
  }
  return value;
}

export interface HostTarget {
  repo: string;
  baseBranch: string;
  gitlab: boolean;
  origin: URL;
  token: string;
  actorId: number;
}

function repositoryOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = gitlabBase(value);
  } catch {
    throw invalidCampaign("Expected an exact fleet origin for the campaign host.");
  }
  if (origin.href.replace(/\/$/u, "") !== value || /%/u.test(origin.pathname)) {
    throw invalidCampaign("Expected an exact fleet origin for the campaign host.");
  }
  return origin;
}

export function approvedTargets(state: CampaignState, permissions: HostPermissions, env: NodeJS.ProcessEnv) {
  if (permissions.campaign !== state.id) throw invalidCampaign("Host permissions do not match this campaign.");
  const byIdentity = new Map(state.repositories.map((row) => [repositoryKey(row.host, row.name), row]));
  const targets = new Map<CampaignRepository, HostTarget>();
  const credentialOrigins = new Map<string, string>();
  for (const { host, name, baseBranch, tokenEnv, actorId } of permissions.repositories) {
    const repo = byIdentity.get(repositoryKey(host, name));
    if (!repo || repo.host !== host || repo.name !== name || targets.has(repo)) {
      throw invalidCampaign("Host permissions must name distinct repositories already selected by the campaign.");
    }
    const origin = repositoryOrigin(host);
    const gitlab = origin.hostname !== "github.com";
    if (!gitlab && (origin.href !== "https://github.com/" || name.split("/").length !== 2)) {
      throw invalidCampaign("GitHub campaign repositories require github.com and an owner/name pair.");
    }
    const token = campaignCredential(env, tokenEnv);
    if (credentialOrigins.has(token) && credentialOrigins.get(token) !== host) {
      throw invalidCampaign("A campaign token can only be sent to its approved origin.");
    }
    credentialOrigins.set(token, host);
    targets.set(repo, { repo: name, baseBranch, gitlab, origin, token, actorId });
  }
  return targets;
}
