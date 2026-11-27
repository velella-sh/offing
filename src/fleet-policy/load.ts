import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { ownersOf, parseCodeowners, CODEOWNERS_LOCATIONS } from "../codeowners.js";
import { ConfigError, type OffingConfig } from "../config.js";
import type { LifecyclePolicy } from "../domain.js";
import { readBoundedFile } from "../package-files.js";
import { cachedPolicy, savePolicy, type RemotePolicySnapshot } from "./cache.js";
import { makePolicyLayer, parseFleetPolicy, pickTeam, policyLocations } from "./document.js";
import { mergeFleetPolicy, type EffectivePolicy } from "./merge.js";
import { parsePolicyReference, type PolicyReference } from "./reference.js";

export interface FleetPolicyOptions {
  root: string;
  today: string;
  config?: OffingConfig | undefined;
  reference?: string | undefined;
  requireUnderRoot?: boolean;
  repository?: string;
  cache?: string;
  fetchPolicy?: (reference: PolicyReference) => Promise<RemotePolicySnapshot>;
}

async function requiredFile(path: string): Promise<string> {
  const result = await readBoundedFile(path);
  if (result?.contents === undefined) {
    throw new ConfigError(`Cannot read policy file ${path}: ${result?.skipped?.detail ?? "file not found"}.`);
  }
  return result.contents;
}

async function rootedFile(root: string, path: string): Promise<string> {
  const located = await realpath(path);
  const fromRoot = relative(root, located);
  if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\") || isAbsolute(fromRoot)) {
    throw new ConfigError(`Policy path ${path} must stay under ${root}.`);
  }
  return located;
}

async function ownerTeams(root: string): Promise<string[]> {
  for (const name of CODEOWNERS_LOCATIONS) {
    const path = await rootedFile(root, resolve(root, name)).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (path) return ownersOf(parseCodeowners(await requiredFile(path)), ".");
  }
  return [];
}

async function readOrganization(source: string, options: FleetPolicyOptions, root: string) {
  const reference = parsePolicyReference(source);
  if (!reference) {
    const base =
      options.reference || options.config?.configPath === undefined ? root : dirname(options.config.configPath);
    const requested = resolve(base, source);
    const path =
      options.reference === undefined || options.requireUnderRoot ? await rootedFile(root, requested) : requested;
    return parseFleetPolicy(await requiredFile(path), path);
  }
  const snapshot = options.fetchPolicy
    ? await options.fetchPolicy(reference)
    : await cachedPolicy(reference, options.cache);
  if (!snapshot) throw new ConfigError(`No pinned policy for ${source}. Run offing policy pull first.`);
  const located = await parseFleetPolicy(
    snapshot.text,
    `${reference.provider}:${reference.repository}/${reference.path}@${snapshot.commit}`,
  );
  if (options.fetchPolicy) await savePolicy(reference, snapshot, options.cache);
  return located;
}

export async function loadFleetPolicy(options: FleetPolicyOptions): Promise<EffectivePolicy | undefined> {
  const source = options.reference ?? options.config?.extends;
  if (!source) return undefined;
  const root = await realpath(options.root);
  const organization = await readOrganization(source, options, root);
  const team = pickTeam(
    organization,
    options.repository ?? basename(root),
    organization.document.teams ? await ownerTeams(root) : [],
  );
  const teams = organization.document.teams;
  const lower =
    team && teams && Object.hasOwn(teams, team)
      ? [makePolicyLayer("team", teams[team]?.policy, organization.source, ["teams", team, "policy"])]
      : [];
  if (options.config?.policy) {
    const configPath = options.config.configPath;
    const source = configPath
      ? policyLocations(await requiredFile(configPath), configPath)
      : () => ({ file: resolve(root, ".offing.json"), line: 1 });
    lower.push(makePolicyLayer("repository", options.config.policy, source));
  }
  return mergeFleetPolicy(
    makePolicyLayer("organization", organization.document.policy, organization.source),
    lower,
    organization.document.allowLoosen ?? [],
    options.today,
  );
}

export async function resolveLifecyclePolicy(options: FleetPolicyOptions): Promise<LifecyclePolicy | undefined> {
  return (await loadFleetPolicy(options))?.policy ?? options.config?.policy;
}
