import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

import { readBoundedFile } from "../package-files.js";
import { list, lockedChain, object, sections, type LockedGraph, type RecordValue } from "./lock-graph.js";
import type { UpgradeIssue } from "./types.js";

const pythonLocks = ["poetry.lock", "uv.lock", "pdm.lock"];

async function readRecord(root: string, path: string, parse: (text: string) => unknown): Promise<RecordValue> {
  try {
    const file = await readBoundedFile(join(root, path));
    return file?.contents === undefined ? {} : object(parse(file.contents));
  } catch {
    return {};
  }
}

function normalizePython(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

interface Dependency {
  name: string;
  version?: string;
}

/** Unknown markers and extras are deliberately omitted rather than guessing the active resolution. */
function pythonDependency(value: unknown): Dependency[] {
  if (typeof value === "string") {
    const match = /^([a-z0-9][a-z0-9._-]*)(?:\s*(?:[<>=!~]|$))/i.exec(value);
    return match?.[1] && !value.includes(";") ? [{ name: match[1] }] : [];
  }
  const entry = object(value);
  if (typeof entry.name !== "string" || entry.marker !== undefined || entry.extra !== undefined) return [];
  return [{ name: entry.name, ...(typeof entry.version === "string" ? { version: entry.version } : {}) }];
}

function pythonTable(value: unknown): Dependency[] {
  return Object.entries(object(value)).flatMap(([name, declaration]) => {
    if (name.toLowerCase() === "python") return [];
    if (typeof declaration === "string") return [{ name }];
    const entry = object(declaration);
    return entry.markers === undefined &&
      entry.python === undefined &&
      entry.optional !== true &&
      !Array.isArray(declaration)
      ? [{ name }]
      : [];
  });
}

function pythonDependencies(value: unknown): Dependency[] {
  return Array.isArray(value) ? value.flatMap(pythonDependency) : pythonTable(value);
}

function pythonRoots(manifest: RecordValue): Dependency[] {
  const project = object(manifest.project);
  const poetry = object(object(manifest.tool).poetry);
  const groups = Object.values(object(poetry.group));
  return [
    ...list(project.dependencies).flatMap(pythonDependency),
    ...Object.values(object(project["optional-dependencies"])).flatMap((value) =>
      list(value).flatMap(pythonDependency),
    ),
    ...Object.values(object(manifest["dependency-groups"])).flatMap((value) => list(value).flatMap(pythonDependency)),
    ...pythonTable(poetry.dependencies),
    ...pythonTable(poetry["dev-dependencies"]),
    ...groups.flatMap((group) => pythonTable(object(group).dependencies)),
  ];
}

function localUvPackage(entry: RecordValue): boolean {
  const source = object(entry.source);
  return source.editable === "." || source.virtual === ".";
}

interface Package {
  id: string;
  name: string;
  version: string;
  dependencies: Dependency[];
}

function packageEntry(entry: RecordValue, dependencies: Dependency[]): Package[] {
  if (typeof entry.name !== "string" || typeof entry.version !== "string") return [];
  return [{ id: entry.name + "@" + entry.version, name: entry.name, version: entry.version, dependencies }];
}

function makeGraph(packages: Package[], roots: Dependency[], normalize: (name: string) => string): LockedGraph {
  const byName = new Map<string, Package[]>();
  for (const entry of packages) {
    const name = normalize(entry.name);
    const existing = byName.get(name) ?? [];
    existing.push(entry);
    byName.set(name, existing);
  }
  const resolve = ({ name, version }: Dependency): string[] => {
    const matches = byName.get(normalize(name))?.filter((entry) => version === undefined || entry.version === version);
    const only = matches?.length === 1 ? matches[0] : undefined;
    return only === undefined ? [] : [only.id];
  };
  return {
    roots: roots.flatMap(resolve),
    labels: new Map(),
    edges: new Map(packages.map((entry) => [entry.id, new Set(entry.dependencies.flatMap(resolve))])),
  };
}

async function pythonGraph(root: string, path: string): Promise<LockedGraph> {
  const [manifest, lock] = await Promise.all([
    readRecord(root, "pyproject.toml", parseToml),
    readRecord(root, path, parseToml),
  ]);
  const records = list(lock.package).map(object);
  const project = records.filter(localUvPackage);
  const roots = [...pythonRoots(manifest), ...project.flatMap((entry) => pythonDependencies(entry.dependencies))];
  const packages = records
    .filter((entry) => !localUvPackage(entry))
    .flatMap((entry) => packageEntry(entry, pythonDependencies(entry.dependencies)));
  return makeGraph(packages, roots, normalizePython);
}

async function composerGraph(root: string): Promise<LockedGraph> {
  const [manifest, lock] = await Promise.all([
    readRecord(root, "composer.json", JSON.parse),
    readRecord(root, "composer.lock", JSON.parse),
  ]);
  const roots = sections(manifest, ["require", "require-dev"]).map((name) => ({ name }));
  const packages = [...list(lock.packages), ...list(lock["packages-dev"])].map(object).flatMap((entry) =>
    packageEntry(
      entry,
      sections(entry, ["require"]).map((name) => ({ name })),
    ),
  );
  return makeGraph(packages, roots, (name) => name.toLowerCase());
}

export async function attachManifestChains(root: string, issues: UpgradeIssue[]): Promise<void> {
  const paths = new Map<string, Promise<LockedGraph>>();
  for (const issue of issues) {
    if (issue.evidence.kind !== "lockfile" || issue.chain !== undefined) continue;
    let graph = paths.get(issue.path);
    if (graph === undefined) {
      if (issue.path === "composer.lock") graph = composerGraph(root);
      else if (pythonLocks.includes(issue.path)) graph = pythonGraph(root, issue.path);
      else continue;
      paths.set(issue.path, graph);
    }
    const chain = lockedChain(await graph, issue.subject);
    if (chain !== undefined) issue.chain = chain;
  }
}
