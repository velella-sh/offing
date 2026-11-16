import { parsePurl, PurlError, purlIdentity } from "@velella/ebb/purl";
import crossSpawn from "cross-spawn";

import { checkDependency } from "./check-dependency.js";
import type { DependencyCheck } from "./check-dependency.js";
import { severityValues } from "./domain.js";
import { required } from "./required.js";
import type { Severity } from "./domain.js";
import { guardOptionCount } from "./cli-args.js";
import { GuardUsageError, parseInstall } from "./guard-parse.js";
import type { GuardPackage, GuardRequest } from "./guard-parse.js";

export { GuardUsageError, parseNpmPackage } from "./guard-parse.js";
export type { GuardPackage, GuardRequest } from "./guard-parse.js";

export function parseNpmInstall(args: readonly string[]): GuardRequest {
  return parseInstall("npm", args);
}

/** The severity at or above which a package is refused; `none` never refuses. */
export type GuardGate = Severity | "none";

export interface GuardCheck {
  package: GuardPackage;
  check?: DependencyCheck;
  error?: string;
}

export interface GuardOptions {
  /** Refuse a package whose highest severity is at or above this value. Defaults to `high`. */
  failOn?: GuardGate;
  /** Run the install even when a package would be refused. */
  override?: boolean;
  /** Canonical package identities or versioned package URLs permitted for this invocation. */
  allow?: readonly string[];
  verbose?: boolean;
  /** Lookup used for each package; defaults to the bundled lifecycle rules. */
  check?: (entry: GuardPackage) => Promise<DependencyCheck>;
  /** Package-manager call used when every package is allowed; defaults to running the command. */
  run?: (request: GuardRequest) => number;
  /** Receives diagnostics before the package manager runs. */
  report?: (output: string) => void;
}

export interface GuardResult {
  allowed: boolean;
  exitCode: number;
  checks: GuardCheck[];
  blockers: GuardCheck[];
  /** Diagnostics printed before running or refusing the install. */
  output: string;
}

interface ParsedGuard {
  request: GuardRequest;
  failOn?: GuardGate;
  override: boolean;
  allow: string[];
  verbose: boolean;
}

const severityRank = new Map(severityValues.map((severity, index) => [severity, index]));
/** Whether an affected check is severe enough for the gate. */
export function blocksInstall(check: DependencyCheck, failOn: GuardGate = "high"): boolean {
  if (failOn === "none" || check.status !== "affected" || check.severity === undefined) return false;
  return (severityRank.get(check.severity) ?? 0) >= (severityRank.get(failOn) ?? 0);
}

/** Decides whether the install may run. Pure: it performs no lookup and runs nothing. */
export function evaluateGuard(
  checks: readonly GuardCheck[],
  options: GuardOptions = {},
): { allowed: boolean; blockers: GuardCheck[] } {
  const failOn = options.failOn ?? "high";
  const blockers = checks.filter(
    (entry) => entry.error !== undefined || (entry.check !== undefined && blocksInstall(entry.check, failOn)),
  );
  return { allowed: options.override === true || blockers.every((entry) => isAllowed(entry, options)), blockers };
}

/** Looks up every package before anything is installed. A failed lookup blocks rather than guesses. */
export async function checkGuardPackages(
  packages: readonly GuardPackage[],
  options: GuardOptions = {},
): Promise<GuardCheck[]> {
  const check =
    options.check ??
    ((entry: GuardPackage) =>
      checkDependency({ purl: entry.purl, ...(entry.version === undefined ? {} : { version: entry.version }) }));
  const checks: GuardCheck[] = [];
  for (const entry of packages) {
    try {
      checks.push({ package: entry, check: await check(entry) });
    } catch (error) {
      checks.push({ package: entry, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return checks;
}

function runPackageManager(request: GuardRequest): number {
  const args = request.arguments.map((argument) => argument.value);
  // Windows command shims cannot carry line breaks safely.
  if (process.platform === "win32" && args.some((argument) => /[\r\n]/.test(argument))) {
    throw new GuardUsageError("Package manager arguments cannot contain line breaks on Windows.");
  }
  const result = crossSpawn.sync(request.command, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function requestPackages(request: GuardRequest): GuardPackage[] {
  return request.arguments.flatMap(({ package: entry, requirements }) => requirements ?? (entry ? [entry] : []));
}

function packageLabel(entry: GuardCheck): string {
  return entry.package.version ? `${entry.package.purl}@${entry.package.version}` : entry.package.purl;
}

function renderCheck(entry: GuardCheck): string[] {
  if (entry.error !== undefined) return [`${packageLabel(entry)}: could not check (${entry.error}).`];
  const check = required(entry.check, "guard check result");
  if (check.findings.length === 0) return [`${packageLabel(entry)}: ${check.message}`];
  return check.findings.flatMap((finding) => [
    `${packageLabel(entry)} — ${finding.title} (${finding.severity}, ${finding.event})`,
    finding.summary,
    ...(finding.replacement === undefined ? [] : [`Replacement: ${finding.replacement}`]),
    ...(finding.deadline === undefined ? [] : [`Deadline: ${finding.deadline}`]),
    ...finding.sources.map((source) => `Evidence: ${source.url}`),
  ]);
}

function isAllowed(entry: GuardCheck, options: GuardOptions): boolean {
  return options.allow?.some((purl) => purl === entry.package.purl || purl === packageLabel(entry)) ?? false;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function findingLines(entry: GuardCheck): string[] {
  const finding = entry.check?.findings[0];
  return [
    oneLine(finding ? packageLabel(entry) + " — " + finding.title : (renderCheck(entry)[0] ?? "")),
    "Replacement: " + oneLine(finding?.replacement ?? "none recorded"),
    "Evidence: " + oneLine(finding?.sources[0]?.url ?? "unavailable"),
  ];
}

function renderRefusal(
  request: GuardRequest,
  blockers: readonly GuardCheck[],
  options: GuardOptions,
  noData: string,
): string {
  const first = required(blockers[0], "guard blocker");
  if (options.verbose === true) {
    return [
      renderRefusal(request, blockers, { ...options, verbose: false }, noData),
      "",
      ...blockers.flatMap(renderCheck),
    ].join("\n");
  }
  return [
    "offing guard: refused to run " +
      request.command +
      " (" +
      blockers.length +
      " blocked, --fail-on " +
      (options.failOn ?? "high") +
      ").",
    ...findingLines(first),
    oneLine(
      "Use --allow <purl> or --force before " +
        request.command +
        " to override, or --verbose for details." +
        (noData ? " " + noData : ""),
    ),
  ].join("\n");
}

function renderAllowed(request: GuardRequest, blockers: readonly GuardCheck[], options: GuardOptions): string[] {
  if (blockers.length === 0) return [];
  if (options.override === true) {
    return [
      "offing guard: running " + request.command + " anyway because --force was given.",
      ...blockers.flatMap(renderCheck),
    ];
  }
  return blockers.map((entry) => "offing guard: --allow override used for " + packageLabel(entry));
}

/** Checks the requested packages and runs the manager only when the gate allows it. */
export async function runGuard(request: GuardRequest, options: GuardOptions = {}): Promise<GuardResult> {
  const checks = await checkGuardPackages(requestPackages(request), options);
  const { allowed, blockers } = evaluateGuard(checks, options);
  const noData = checks
    .filter((entry) => entry.check?.status === "no-data")
    .map((entry) => "no data for " + packageLabel(entry))
    .join(", ");
  const output = allowed
    ? [...renderAllowed(request, blockers, options), noData].filter(Boolean).join("\n")
    : renderRefusal(
        request,
        blockers.filter((entry) => !isAllowed(entry, options)),
        options,
        noData,
      );
  if (output !== "") options.report?.(output);
  if (!allowed) return { allowed: false, exitCode: 1, checks, blockers, output };
  const run = options.run ?? runPackageManager;
  return { allowed: true, exitCode: run(request), checks, blockers, output };
}

function parseGate(value: string | undefined): GuardGate {
  if (value === undefined || (value !== "none" && !severityValues.includes(value as Severity))) {
    throw new GuardUsageError("--fail-on needs one of: none, " + severityValues.join(", ") + ".");
  }
  return value as GuardGate;
}

function parseAllow(value: string | undefined): string {
  try {
    const purl = parsePurl(value ?? "");
    if (purl.qualifiers || purl.subpath) throw new PurlError("Unexpected qualifier or subpath.");
    const identity = purlIdentity(purl);
    return purl.version === undefined ? identity : identity + "@" + purl.version;
  } catch (error) {
    if (!(error instanceof PurlError)) throw error;
    throw new GuardUsageError("--allow needs a package URL, for example pkg:npm/request.");
  }
}

function parseGuardOptions(args: readonly string[]): Omit<ParsedGuard, "request"> {
  const options: Omit<ParsedGuard, "request"> = { override: false, allow: [], verbose: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    switch (argument) {
      case "--fail-on":
        options.failOn = parseGate(value);
        break;
      case "--allow":
        options.allow.push(parseAllow(value));
        break;
      case "--data-version":
        if (!value || value.startsWith("-")) {
          throw new GuardUsageError('--data-version needs a version, for example 2026.10.01, or "bundled".');
        }
        break;
      case "--force":
        options.override = true;
        continue;
      case "--verbose":
        options.verbose = true;
        continue;
      default:
        throw new GuardUsageError("Unknown guard option: " + argument + ".");
    }
    index += 1;
  }
  return options;
}

/** Offing consumes options before the manager token. All later arguments belong to the manager. */
export function parseGuardArgs(args: readonly string[]): ParsedGuard {
  const index = guardOptionCount(args);
  const options = parseGuardOptions(args.slice(0, index));
  const manager = args[index];
  if (manager === undefined) {
    throw new GuardUsageError("Missing package manager. Use offing guard npm install <package>.");
  }
  return { request: parseInstall(manager, args.slice(index + 1)), ...options };
}

/** The CLI entry point: parse, check, and run the package manager only when allowed. */
export async function guardCommand(args: readonly string[], options: GuardOptions = {}): Promise<GuardResult> {
  const { request, failOn, override, allow, verbose } = parseGuardArgs(args);
  return runGuard(request, {
    ...options,
    ...(failOn === undefined ? {} : { failOn }),
    override: override || options.override === true,
    allow: [...(options.allow ?? []), ...allow],
    verbose: verbose || options.verbose === true,
  });
}
