import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

import { getActiveData } from "@velella/ebb/data-source";
import { isIsoDate } from "@velella/ebb/registry";

import { CODEOWNERS_LOCATIONS } from "../codeowners.js";
import { CONFIG_FILE_NAME } from "../config.js";
import { fleetPolicyCompliance, type FleetPolicyCompliance } from "../fleet-policy/compliance.js";
import { parsePolicyReference } from "../fleet-policy/reference.js";
import { defaultCacheDirectory } from "../cache-paths.js";
import { declaresInput, detectorSparsePatterns } from "../detector-inputs.js";
import { builtInDetectors } from "../detectors/index.js";
import { captureForecast, ownershipLocations } from "../fleet-forecast/capture.js";
import type { ForecastCapture } from "../fleet-forecast/model.js";
import { rollup, type FleetRepositoryStatus, type FleetResult, type RollupFinding } from "../rollup.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import { globToRegExp } from "../workspaces.js";
import { VERSION } from "../version.js";
import { fleetCacheKey, readFleetCache, writeFleetCache } from "./cache.js";
import { FleetHostError, type FleetHost, type FleetRepository, type FleetSelection } from "./host.js";
import { validCommit } from "./remote.js";

const inputs = builtInDetectors.flatMap((detector) => (detector.inputs ? [detector.inputs] : []));
const selection: FleetSelection = {
  patterns: detectorSparsePatterns(inputs),
  includes: (path) => inputs.some((input) => declaresInput(input, path)),
};

const policyPaths = [CONFIG_FILE_NAME, ...CODEOWNERS_LOCATIONS];
export interface FleetProgress extends FleetRepositoryStatus {
  readonly bytesFetched: number;
}

export interface FleetOptions {
  readonly jobs?: number;
  readonly cacheDirectory?: string;
  readonly noCache?: boolean;
  readonly policy?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly topics?: readonly string[];
  readonly repositories?: readonly string[];
  readonly includeForks?: boolean;
  readonly includeArchived?: boolean;
  readonly onProgress?: (event: FleetProgress) => void;
  readonly forecast?: { readonly gitlab: boolean; readonly asOf?: string };
}

interface RepositoryScan {
  readonly state: FleetRepositoryStatus;
  readonly findings: readonly RollupFinding[];
  readonly bytesFetched: number;
}

interface FleetContext {
  readonly host: FleetHost;
  readonly cache: string;
  readonly fingerprint: string;
  readonly scannedAt: string;
  readonly noCache: boolean;
  readonly forecast?: FleetOptions["forecast"];
  readonly policy?: string;
}

function matches(name: string, patterns: readonly string[] = []): boolean {
  const leaf = posix.basename(name);
  return patterns.map(globToRegExp).some((pattern) => pattern.test(name) || pattern.test(leaf));
}

function skipReason(repo: FleetRepository, options: FleetOptions): string | undefined {
  if (repo.disabled) return "Repository is disabled.";
  if (repo.archived && !options.includeArchived) return "Repository is archived.";
  if (repo.fork && !options.includeForks) return "Repository is a fork.";
  if (!repo.defaultBranch) return "Repository has no default branch.";
  if (
    options.repositories &&
    !options.repositories.includes(repo.name) &&
    !options.repositories.includes(posix.basename(repo.name))
  ) {
    return "Repository is not in the requested list.";
  }
  if ((options.include?.length && !matches(repo.name, options.include)) || matches(repo.name, options.exclude)) {
    return "Repository did not match the name filters.";
  }
  if (options.topics && !options.topics.every((topic) => repo.topics.includes(topic))) {
    return "Repository did not match the topic filters.";
  }
  return undefined;
}

function safeFindings(findings: readonly RollupFinding[]): RollupFinding[] {
  // Aggregate keys come from lifecycle rules rather than source excerpts, paths or diagnostics.
  return findings.map(({ ruleId, severity, deadline }) => ({
    ruleId: /^[a-z0-9][a-z0-9._-]{0,159}$/u.test(ruleId) ? ruleId : "other",
    severity,
    ...(deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? { deadline } : {}),
  }));
}

function selectedInputs(context: FleetContext): FleetSelection {
  const locations = new Set([
    ...(context.forecast ? ownershipLocations(context.forecast.gitlab) : []),
    ...(context.policy ? policyPaths : []),
  ]);
  if (locations.size === 0) return selection;
  return {
    patterns: [...selection.patterns, ...[...locations].map((file) => `/${file}`)],
    includes: (file) => selection.includes(file) || locations.has(file),
  };
}

interface PinnedScan extends Omit<RepositoryScan, "state"> {
  readonly compliance?: FleetPolicyCompliance;
  readonly forecastEvidence?: ForecastCapture;
}

async function scanPinned(context: FleetContext, repository: FleetRepository, commit: string): Promise<PinnedScan> {
  const directory = await mkdtemp(join(tmpdir(), "offing-fleet-"));
  try {
    const bytesFetched = await context.host.fetchFilesAtCommit(repository, commit, directory, selectedInputs(context));
    const report = await scanWithBuiltIns(directory, { noCache: true, scannedAt: context.scannedAt });
    const policy = context.policy;
    const compliance = policy
      ? await fleetPolicyCompliance(report, {
          root: directory,
          reference: policy,
          repository: repository.name,
          today: context.scannedAt.slice(0, 10),
        })
      : undefined;
    const forecastEvidence = context.forecast ? await captureForecast(report, context.forecast.gitlab) : undefined;
    return {
      bytesFetched,
      findings: safeFindings(report.findings),
      ...(compliance ? { compliance } : {}),
      ...(forecastEvidence ? { forecastEvidence } : {}),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function scanOne(repo: FleetRepository, context: FleetContext, options: FleetOptions): Promise<RepositoryScan> {
  const state = { name: repo.name, host: context.host.origin, defaultBranch: repo.defaultBranch };
  const skip = skipReason(repo, options);
  if (skip)
    return { state: { ...state, commit: null, status: "skipped", reason: skip }, findings: [], bytesFetched: 0 };

  let commit: string | null = null;
  try {
    const head = await context.host.readDefaultBranchHead(repo);
    if (!validCommit(head)) throw new FleetHostError("Invalid fleet commit SHA.");
    commit = head;
    const key = fleetCacheKey([context.fingerprint, context.host.origin, repo.name, commit]);
    const cached = context.noCache ? undefined : await readFleetCache(context.cache, key);
    if (cached) {
      return { state: { ...state, commit, status: "cached", reason: null }, findings: cached, bytesFetched: 0 };
    }
    const { compliance, forecastEvidence, ...report } = await scanPinned(context, repo, commit);
    if (!context.noCache) {
      // A read-only cache directory must not turn a successful scan into a failed repository.
      await writeFleetCache(context.cache, key, report.findings).catch(() => undefined);
    }
    return {
      state: {
        ...state,
        commit,
        status: "scanned",
        reason: null,
        ...(compliance ? { compliance } : {}),
        ...(forecastEvidence ? { forecastEvidence } : {}),
      },
      ...report,
    };
  } catch (error) {
    const reason = error instanceof FleetHostError ? error.message : "Could not scan the pinned tree.";
    return { state: { ...state, commit, status: "failed", reason }, findings: [], bytesFetched: 0 };
  }
}

export async function scanFleet(host: FleetHost, namespace: string, options: FleetOptions = {}): Promise<FleetResult> {
  const jobs = options.jobs ?? 4;
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) {
    throw new FleetHostError("Fleet concurrency must be an integer between 1 and 16.");
  }
  const data = await getActiveData();
  const asOf = options.forecast?.asOf;
  if (asOf !== undefined && !isIsoDate(asOf)) throw new FleetHostError("--as-of needs a date (YYYY-MM-DD).");
  const scannedAt = asOf === undefined ? new Date().toISOString() : `${asOf}T00:00:00.000Z`;
  const fingerprint = fleetCacheKey([VERSION, data.info.version, scannedAt.slice(0, 10), ...selection.patterns]);
  const context = {
    host,
    fingerprint,
    scannedAt,
    // Existing scan-cache entries contain aggregate findings only.
    noCache: options.forecast !== undefined || options.policy !== undefined || (options.noCache ?? false),
    forecast: options.forecast,
    ...(options.policy
      ? { policy: parsePolicyReference(options.policy) ? options.policy : resolve(options.policy) }
      : {}),
    cache: options.cacheDirectory ?? join(defaultCacheDirectory(), "fleet-v1"),
  };
  const repos = [...(await host.listRepositories(namespace))].sort((a, b) => a.name.localeCompare(b.name, "en"));
  const remaining = repos.entries();
  const results: RepositoryScan[] = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, repos.length) }, async () => {
      for (const [index, repo] of remaining) {
        const result = await scanOne(repo, context, options);
        results[index] = result;
        options.onProgress?.({ ...result.state, bytesFetched: result.bytesFetched });
      }
    }),
  );
  const aggregated = rollup(results.map(({ state, findings }) => ({ repository: state.name, report: { findings } })));
  return {
    ...aggregated,
    schemaVersion: "offing.fleet.v1",
    repositoryStatus: results.map(({ state }) => state),
    ...(options.forecast ? { forecastAsOf: scannedAt.slice(0, 10) } : {}),
  };
}
