import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import semver from "semver";

import { parseRequirement } from "./detectors/python/shared.js";
import { OffingError } from "./offing-error.js";
import { required } from "./required.js";

export class GuardUsageError extends OffingError {
  constructor(message: string) {
    super("invalid-argument", message);
    this.name = "GuardUsageError";
  }
}

/** One package argument, resolved to the identity and version Offing can judge. */
export interface GuardPackage {
  /** Canonical package URL without a version. */
  purl: string;
  /** The version, or the lower bound of a range, named by the install argument. */
  version?: string;
  /** The argument exactly as written; the package manager receives this. */
  spec: string;
}

/** One raw package-manager argument, marked when it is a registry package to check. */
export interface GuardArgument {
  value: string;
  package?: GuardPackage;
  requirements?: GuardPackage[];
}

/** One package-manager invocation, with its arguments kept in the order the user wrote them. */
export interface GuardRequest {
  command: string;
  arguments: GuardArgument[];
}

const npmInstallCommands = new Set(["install", "i", "add"]);
const npmName = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;
const npmVersion = /^[A-Za-z0-9._~^<>=*|+ -]+$/;
const npmValueFlags = new Set([
  "-w",
  "--workspace",
  "--prefix",
  "--tag",
  "--cache",
  "--loglevel",
  "--registry",
  "--userconfig",
  "--globalconfig",
  "--location",
  "--save-prefix",
  "--omit",
  "--include",
  "--install-strategy",
  "--also",
  "--os",
  "--cpu",
  "--libc",
  "--scope",
  "--before",
  "--auth-type",
  "--ca",
  "--cafile",
  "--cert",
  "--key",
  "--fetch-retries",
  "--fetch-retry-factor",
  "--fetch-retry-mintimeout",
  "--fetch-retry-maxtimeout",
  "--fetch-timeout",
  "--maxsockets",
  "--proxy",
  "--https-proxy",
  "--noproxy",
  "--script-shell",
  "--node-options",
  "--user-agent",
]);

/** The version npm would install first, when the spec names one Offing can match. */
function checkableVersion(version: string | undefined): string | undefined {
  if (version === undefined) return undefined;
  const trimmed = version.trim();
  if (trimmed === "") return undefined;
  const range = semver.validRange(trimmed);
  return range === null ? undefined : semver.minVersion(range)?.version;
}

/** Whether the argument names a registry package rather than a path, URL, VCS spec, or alias. */
function isRegistrySpec(spec: string): boolean {
  if (spec === "" || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~")) return false;
  // file:, git:, https:, workspace:, npm: aliases and similar non-registry specs are left to npm.
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec);
}

interface NpmSpec {
  name: string;
  version?: string;
}

/** Splits `@scope/name` or `@scope/name@version`; a scoped name without a slash is not a package. */
function splitScopedSpec(spec: string): NpmSpec | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 1) return undefined;
  const at = spec.indexOf("@", slash + 1);
  return at === -1 ? { name: spec } : { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** Splits `name` or `name@version`. */
function splitUnscopedSpec(spec: string): NpmSpec {
  const at = spec.indexOf("@");
  return at === -1 ? { name: spec } : { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** Whether an optional version is a range npm can resolve to a checkable release. */
function isNpmVersion(version: string | undefined): boolean {
  if (version === undefined) return true;
  if (version === "" || version.includes("/") || version.startsWith("npm:")) return false;
  return npmVersion.test(version);
}

function splitNpmSpec(spec: string): NpmSpec | undefined {
  if (!isRegistrySpec(spec)) return undefined;
  const parsed = spec.startsWith("@") ? splitScopedSpec(spec) : splitUnscopedSpec(spec);
  if (parsed === undefined) return undefined;
  if (!npmName.test(parsed.name) || !isNpmVersion(parsed.version)) return undefined;
  return parsed;
}

/** Resolves one npm install argument, or undefined when it is not a registry package spec. */
export function parseNpmPackage(spec: string): GuardPackage | undefined {
  const parsed = splitNpmSpec(spec);
  if (parsed === undefined) return undefined;
  const version = checkableVersion(parsed.version);
  const encodedName = parsed.name.startsWith("@") ? `%40${parsed.name.slice(1)}` : parsed.name;
  return {
    purl: `pkg:npm/${encodedName}`,
    ...(version === undefined ? {} : { version }),
    spec,
  };
}

const registryFlags = new Set([
  ...npmValueFlags,
  "--config",
  "--cwd",
  "--dir",
  "--filter",
  "--filter-prod",
  "--network-concurrency",
  "--network-timeout",
  "--reporter",
  "--otp",
  "--store-dir",
  "--allow-build",
  "--global-dir",
  "--global-bin-dir",
  "--modules-dir",
  "--virtual-store-dir",
  "--lockfile-dir",
  "-F",
  "-C",
]);

const pythonFlags = new Set([
  "-c",
  "--constraint",
  "-e",
  "--editable",
  "-f",
  "--find-links",
  "-i",
  "--index-url",
  "--extra-index-url",
  "--index",
  "--default-index",
  "--index-strategy",
  "-p",
  "--python",
  "-t",
  "--target",
  "--prefix",
  "--root",
  "--platform",
  "--python-version",
  "--implementation",
  "--abi",
  "--upgrade-strategy",
  "--only-binary",
  "--no-binary",
  "--config-settings",
  "-C",
  "--report",
  "--log",
  "--proxy",
  "--retries",
  "--timeout",
  "--trusted-host",
  "--cert",
  "--client-cert",
  "--cache-dir",
  "--keyring-provider",
  "--progress-bar",
  "--root-user-action",
  "--group",
  "--optional",
  "--package",
  "--project",
  "--directory",
  "--config-file",
  "--color",
  "--override",
  "--build-constraints",
  "--exclude-newer",
  "--prerelease",
  "--resolution",
  "--python-platform",
  "--upgrade-package",
  "--reinstall-package",
]);

const managerVerbs = new Map([
  ["npm", "install"],
  ["pnpm", "add"],
  ["yarn", "add"],
  ["bun", "add"],
  ["pip", "install"],
  ["uv", "add"],
]);

function acceptsVerb(command: string, expected: string, value: string): boolean {
  return command === "npm" ? npmInstallCommands.has(value) : value === expected;
}

function managerValueFlags(command: string): ReadonlySet<string> {
  if (command === "pip" || command === "uv") return pythonFlags;
  // pnpm's workspace flags take no operands.
  if (command === "pnpm") return new Set([...registryFlags].filter((flag) => flag !== "-w" && flag !== "--workspace"));
  if (command === "npm") return npmValueFlags;
  return registryFlags;
}

function parsePythonPackage(spec: string): GuardPackage | undefined {
  const parsed = parseRequirement(spec);
  if (!parsed) return undefined;
  const { name, constraint } = parsed;
  // The shared parser also accepts arbitrary trailing text. Only registry requirements apply here.
  if (constraint !== "" && !/^(?:===?|~=|!=|<=?|>=?).+/.test(constraint)) return undefined;
  const version = /^===?\s*([A-Za-z0-9!+._-]+)$/.exec(constraint)?.[1];
  return { purl: "pkg:pypi/" + name, ...(version === undefined ? {} : { version }), spec };
}

function requirementOperand(argument: string): string | undefined {
  return /^(?:--requirements?(?:[=\s]+|$)|-r[=\s]*)(.*)$/.exec(argument)?.[1];
}

function requirementFile(operand: string, base: string): string {
  const name = operand.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!name || name === "-" || /^[a-z][a-z\d+.-]*:\/\//i.test(name) || name.includes("${")) {
    throw new GuardUsageError("Expected a local requirements file.");
  }
  return resolve(base, name);
}

function requirementLines(path: string): string[] {
  try {
    if (!statSync(path).isFile()) throw new Error("Expected a regular file.");
    return readFileSync(path, "utf8")
      .replace(/\\\r?\n/g, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/(?:^|\s+)#.*$/, "").trim());
  } catch (error) {
    throw new GuardUsageError("Cannot read requirements file " + path + ": " + String(error));
  }
}

function readRequirements(path: string, seen: Set<string>): GuardPackage[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const packages: GuardPackage[] = [];
  for (const line of requirementLines(path)) {
    const include = requirementOperand(line);
    if (include !== undefined) {
      packages.push(...readRequirements(requirementFile(include, dirname(path)), seen));
      continue;
    }
    const entry = parsePythonPackage(line.replace(/\s+--hash[=\s].*$/, ""));
    if (entry !== undefined) packages.push(entry);
  }
  return packages;
}

function flagArgs(
  flag: string,
  following: string | undefined,
  python: boolean,
  flags: ReadonlySet<string>,
  base: string,
): GuardArgument[] {
  const operand = python ? requirementOperand(flag) : undefined;
  if (operand !== undefined) {
    const path = requirementFile(operand || following || "", base);
    const entry = { value: flag, requirements: readRequirements(path, new Set()) };
    return operand === "" && following !== undefined ? [entry, { value: following }] : [entry];
  }
  return flags.has(flag) && following !== undefined ? [{ value: flag }, { value: following }] : [{ value: flag }];
}

/** uv resolves relative requirements paths after applying its global working-directory option. */
function uvDirectory(args: readonly string[]): string {
  let base = process.env.UV_WORKING_DIR || ".";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg?.startsWith("--directory=")) base = arg.slice("--directory=".length);
    if (arg === "--directory") base = args[index + 1] ?? base;
    if (arg && (pythonFlags.has(arg) || requirementOperand(arg) === "")) index += 1;
  }
  return base;
}

/** Parse the manager's arguments for checking, keeping every original token for execution. */
export function parseInstall(command: string, args: readonly string[]): GuardRequest {
  const expected = managerVerbs.get(command);
  if (!expected)
    throw new GuardUsageError('Unsupported package manager "' + command + '". Use npm, pnpm, yarn, bun, pip, or uv.');
  const python = command === "pip" || command === "uv";
  const flags = managerValueFlags(command);
  const base = command === "uv" ? uvDirectory(args) : ".";
  const argumentsList: GuardArgument[] = [];
  let verb: string | undefined;
  let positional = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = required(args[index], "package manager argument");
    if (!positional && value.startsWith("-")) {
      if (value === "--") positional = true;
      const consumed = flagArgs(value, args[index + 1], python && verb !== undefined, flags, base);
      argumentsList.push(...consumed);
      index += consumed.length - 1;
    } else if (verb === undefined) {
      if (!acceptsVerb(command, expected, value)) throw expectedVerb(command, expected, value);
      verb = value;
      argumentsList.push({ value });
    } else {
      const entry = python ? parsePythonPackage(value) : parseNpmPackage(value);
      argumentsList.push(entry === undefined ? { value } : { value, package: entry });
    }
  }
  if (verb === undefined) throw expectedVerb(command, expected);
  return { command, arguments: argumentsList };
}

function expectedVerb(command: string, expected: string, value = ""): GuardUsageError {
  return new GuardUsageError("Expected `" + command + " " + expected + "`; got `" + command + " " + value + "`.");
}
