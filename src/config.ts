import { isIsoDate } from "@velella/ebb/registry";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { LifecyclePolicy, PolicyException, PolicyRule, ScanResult, Severity } from "./domain.js";
import { severityValues } from "./domain.js";
import { OffingError } from "./offing-error.js";

export const CONFIG_FILE_NAME = ".offing.json";

export class ConfigError extends OffingError {
  constructor(message: string) {
    super("invalid-config", message);
    this.name = "ConfigError";
  }
}

export interface OffingConfig {
  $schema?: string;
  schemaVersion?: string;
  failOn?: Severity | "none";
  ignore?: string[];
  dataVersion?: string;
  baseline?: string[];
  policy?: LifecyclePolicy;
  extends?: string;
  configPath?: string;
}

const CONFIG_SCHEMA_VERSION = "offing.config.v1";

export const KNOWN_CONFIG_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "failOn",
  "fail-on",
  "ignore",
  "ignorePaths",
  "ignore-paths",
  "dataVersion",
  "data-version",
  "baseline",
  "baselines",
  "baselineFiles",
  "baseline-files",
  "policy",
  "extends",
]);

/**
 * Validates raw configuration data, ensuring no unknown keys exist and all fields conform to types.
 */
export function validateConfig(raw: unknown, filePath = CONFIG_FILE_NAME): OffingConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`Invalid configuration in ${filePath}: expected a JSON object.`);
  }

  const record = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !KNOWN_CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(
      `Unknown key in ${filePath}: "${unknownKeys[0]}" (allowed keys: fail-on, ignore, data-version, baseline, policy, extends).`,
    );
  }

  if (record.$schema !== undefined && typeof record.$schema !== "string") {
    throw new ConfigError(`Invalid $schema in ${filePath}: expected a string.`);
  }
  if (record.schemaVersion !== undefined && record.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new ConfigError(`Invalid schemaVersion in ${filePath}: expected "${CONFIG_SCHEMA_VERSION}".`);
  }

  const failOn = parseAliases(record, ["failOn", "fail-on"], (value) => parseFailOn(value, filePath));
  const dataVersion = parseAliases(record, ["dataVersion", "data-version"], (value) =>
    parseDataVersion(value, filePath),
  );
  const ignore = parseAliases(record, ["ignore", "ignorePaths", "ignore-paths"], (value) =>
    parsePathList(value, filePath, IGNORE_PROBLEMS),
  );
  const baseline = parseAliases(record, ["baseline", "baselines", "baselineFiles", "baseline-files"], (value) =>
    parsePathList(value, filePath, BASELINE_PROBLEMS),
  );

  return {
    ...(record.$schema !== undefined ? { $schema: record.$schema } : {}),
    ...(record.schemaVersion ? { schemaVersion: CONFIG_SCHEMA_VERSION } : {}),
    ...(failOn !== undefined ? { failOn } : {}),
    ...(dataVersion !== undefined ? { dataVersion } : {}),
    ...(ignore !== undefined ? { ignore } : {}),
    ...(baseline !== undefined ? { baseline } : {}),
    ...parsePolicy(record.policy, filePath),
    ...parseFleetParent(record.extends, filePath),
  };
}

function parseFleetParent(value: unknown, filePath: string): Pick<OffingConfig, "extends"> {
  if (value === undefined) return {};
  if (!nonblank(value)) {
    throw new ConfigError(`Invalid extends in ${filePath}: expected a policy path or pinned remote reference.`);
  }
  return { extends: value.trim() };
}

function policyObject<T extends object>(raw: unknown, keys: readonly string[], location: string): Partial<T> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`Invalid policy at ${location}: expected an object.`);
  }
  const unknown = Object.keys(raw).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new ConfigError(`Unknown policy key "${unknown}" at ${location}.`);
  return raw;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validPolicyScope(value: { path?: string; ecosystem?: string }): boolean {
  return (
    (value.path === undefined || nonblank(value.path)) && (value.ecosystem === undefined || nonblank(value.ecosystem))
  );
}

function parsePolicyRule(value: unknown, location: string): PolicyRule {
  const rule = policyObject<PolicyRule>(
    value,
    ["id", "days-left", "after-eol", "severity", "ecosystem", "path"],
    location,
  );
  if (!nonblank(rule.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rule.id)) {
    throw new ConfigError(`Invalid policy rule id at ${location}: use letters, digits, underscores or hyphens.`);
  }
  if (!validPolicyScope(rule) || Object.keys(rule).length === 1) {
    throw new ConfigError(`Invalid policy rule at ${location}: at least one valid condition is required.`);
  }
  const days = rule["days-left"];
  if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 3650)) {
    throw new ConfigError(`Invalid policy days-left at ${location}: use a whole number from 0 to 3650.`);
  }
  if (rule["after-eol"] !== undefined && typeof rule["after-eol"] !== "boolean") {
    throw new ConfigError(`Invalid policy after-eol at ${location}: expected a boolean.`);
  }
  if (rule.severity !== undefined && !severityValues.includes(rule.severity)) {
    throw new ConfigError(`Invalid policy severity at ${location}.`);
  }
  return { ...rule, id: rule.id };
}

function parsePolicyException(value: unknown, location: string): PolicyException {
  const item = policyObject<PolicyException>(value, ["path", "ecosystem", "reason", "expires", "owner"], location);
  if (!validPolicyScope(item) || (item.path === undefined && item.ecosystem === undefined)) {
    throw new ConfigError(`Invalid policy exception at ${location}: a path or ecosystem is required.`);
  }
  if (item.owner !== undefined && !nonblank(item.owner)) {
    throw new ConfigError(`Invalid policy exception owner at ${location}.`);
  }
  if (!nonblank(item.reason) || !isIsoDate(item.expires)) {
    throw new ConfigError(
      `Invalid policy exception at ${location}: a reason and expiry date (YYYY-MM-DD) are required.`,
    );
  }
  return { ...item, reason: item.reason, expires: item.expires };
}

function parsePolicy(value: unknown, filePath: string): Pick<OffingConfig, "policy"> {
  if (value === undefined) return {};
  const config = policyObject<LifecyclePolicy>(value, ["rules", "exceptions"], filePath);
  if (!Array.isArray(config.rules) || config.rules.length === 0) {
    throw new ConfigError(`Invalid policy rules in ${filePath}: expected a nonempty array.`);
  }
  if (config.exceptions !== undefined && !Array.isArray(config.exceptions)) {
    throw new ConfigError(`Invalid policy exceptions in ${filePath}: expected an array.`);
  }
  const rules = config.rules.map((rule, index) => parsePolicyRule(rule, `${filePath} policy.rules[${index}]`));
  const exceptions = config.exceptions?.map((entry, index) =>
    parsePolicyException(entry, `${filePath} policy.exceptions[${index}]`),
  );
  return { policy: { rules, ...(exceptions ? { exceptions } : {}) } };
}

/** Validate each spelling and retain the first non-null value. */
function parseAliases<T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  parse: (value: unknown) => T | undefined,
): T | undefined {
  return keys.map((key) => parse(record[key] ?? undefined)).find((value) => value !== undefined);
}

function parseFailOn(raw: unknown, filePath: string): (Severity | "none") | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || (raw !== "none" && !severityValues.includes(raw as Severity))) {
    throw new ConfigError(
      `Invalid severity for fail-on in ${filePath}: "${String(raw)}" (expected none, ${severityValues.join(", ")}).`,
    );
  }
  return raw as Severity | "none";
}

function parseDataVersion(raw: unknown, filePath: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError(`Invalid data-version in ${filePath}: expected non-empty string.`);
  }
  return raw.trim();
}

/** The wording of each problem a path-list key (`ignore`, `baseline`) can have. */
interface PathListProblems {
  emptyPath: (filePath: string) => string;
  badItem: (filePath: string) => string;
  badShape: (filePath: string) => string;
}

const IGNORE_PROBLEMS: PathListProblems = {
  emptyPath: (filePath) => `Invalid ignore path in ${filePath}: cannot be empty.`,
  badItem: (filePath) => `Invalid ignore in ${filePath}: expected array of non-empty strings.`,
  badShape: (filePath) => `Invalid ignore in ${filePath}: expected string or array of strings.`,
};

const BASELINE_PROBLEMS: PathListProblems = {
  emptyPath: (filePath) => `Invalid baseline path in ${filePath}: cannot be empty.`,
  badItem: (filePath) => `Invalid baseline in ${filePath}: expected array of non-empty file paths.`,
  badShape: (filePath) => `Invalid baseline in ${filePath}: expected file path or array of file paths.`,
};

/** A single path or a list of paths, trimmed. Absent stays absent. */
function parsePathList(raw: unknown, filePath: string, problems: PathListProblems): string[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    if (raw.trim() === "") throw new ConfigError(problems.emptyPath(filePath));
    return [raw.trim()];
  }
  if (!Array.isArray(raw)) throw new ConfigError(problems.badShape(filePath));
  if (raw.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ConfigError(problems.badItem(filePath));
  }
  return raw.map((item) => (item as string).trim());
}

/**
 * Searches for .offing.json starting in `startDir` and traversing upward until the repository
 * root (.git) or the filesystem root.
 */
export async function findConfigFile(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, CONFIG_FILE_NAME);
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Continue searching
    }

    try {
      const gitDir = join(current, ".git");
      const gitStats = await stat(gitDir);
      if (gitStats.isDirectory() || gitStats.isFile()) {
        break;
      }
    } catch {
      // Not at git root yet
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Loads and validates .offing.json for a target project path.
 * Returns undefined if no configuration file exists.
 */
export async function loadConfig(targetPath?: string): Promise<OffingConfig | undefined> {
  const startDir = targetPath ? resolve(targetPath) : process.cwd();
  let configPath: string | undefined;

  try {
    const targetStat = await stat(startDir);
    if (targetStat.isFile()) {
      if (basename(startDir) === CONFIG_FILE_NAME) {
        configPath = startDir;
      } else {
        configPath = await findConfigFile(dirname(startDir));
      }
    } else {
      configPath = await findConfigFile(startDir);
    }
  } catch {
    return undefined;
  }

  if (!configPath) return undefined;

  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Cannot read config file at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const validated = validateConfig(parsed, configPath);
  const configDir = dirname(configPath);
  const resolvedBaselines = validated.baseline?.map((path) => resolve(configDir, path));

  return {
    ...validated,
    ...(resolvedBaselines ? { baseline: resolvedBaselines } : {}),
    configPath,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translates an ignore pattern into a regular expression over repository-relative paths.
 */
export function patternToRegExp(pattern: string): RegExp {
  const directory = pattern.endsWith("/");
  const body = directory ? pattern.slice(0, -1) : pattern;
  const anchored = body.startsWith("/") || body.includes("/");
  const segments = body.replace(/^\//, "").split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? ".*" : "(?:.*/)?";
      return;
    }
    source += [...segment]
      .map((character) => (character === "*" ? "[^/]*" : character === "?" ? "[^/]" : escapeRegExp(character)))
      .join("");
    if (!last) source += "/";
  });
  const covers = directory ? "/.*" : /[*?]/.test(segments[segments.length - 1] ?? "") ? "" : "(?:/.*)?";
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}${covers}$`);
}

/**
 * Checks whether a repository-relative path matches any ignore pattern.
 */
export function matchesIgnorePattern(patterns: readonly string[], filePath: string): boolean {
  const cleanPatterns = patterns.filter((pattern) => pattern.trim().length > 0);
  if (cleanPatterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return cleanPatterns.some((pattern) => patternToRegExp(pattern).test(normalized));
}

/**
 * Filters out findings and coverage paths that match any of the given ignore patterns.
 */
export function applyIgnore(result: ScanResult, patterns: readonly string[]): ScanResult {
  const cleanPatterns = patterns.filter((pattern) => pattern.trim().length > 0);
  if (cleanPatterns.length === 0) return result;
  const isIgnored = (path: string) => matchesIgnorePattern(cleanPatterns, path);

  const findings = result.findings.filter((finding) => !isIgnored(finding.location.path));

  let coverage = result.coverage;
  if (coverage) {
    coverage = {
      ...coverage,
      filesRead: coverage.filesRead.filter((path) => !isIgnored(path)),
      unsupportedFiles: coverage.unsupportedFiles.filter((path) => !isIgnored(path)),
    };
  }

  return {
    ...result,
    findings,
    ...(coverage ? { coverage } : {}),
  };
}
