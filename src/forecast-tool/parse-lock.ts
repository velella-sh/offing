import { visit } from "jsonc-parser";
import semver from "semver";

import { packageNameFromNodeModulesPath, parsePackageLock } from "../detectors/npm/lockfiles/package-lock.js";
import { emptyLockData } from "../detectors/npm/lockfiles/shared.js";
import { declaredDependencies, parsePackageManifest } from "../detectors/npm/manifest.js";
import { isRecord, record, reference } from "./references.js";
import type { Reference } from "./references.js";

const npmName = /^(?:@[\w.-]+\/)?[\w.-]+$/;

function lockReferences(packages: Record<string, unknown>, path: string): Reference[] {
  const references = new Map<string, Reference>();
  for (const [key, entry] of Object.entries(packages)) {
    const fallback = packageNameFromNodeModulesPath(key);
    if (!fallback) continue;
    const { name = fallback, version, link } = record(entry);
    if (link === true || typeof name !== "string" || !npmName.test(name)) continue;
    const parsed = typeof version === "string" ? (semver.valid(version) ?? undefined) : undefined;
    const item = reference(`pkg:npm/${name}`, parsed, path);
    references.set(`${item.purl}@${parsed ?? ""}`, item);
  }
  return [...references.values()];
}

function legacyLockReferences(contents: string, path: string): Reference[] {
  const data = emptyLockData();
  parsePackageLock(contents, data);
  return [...data.versions].flatMap(([name, versions]) =>
    npmName.test(name) ? [...versions].map((version) => reference(`pkg:npm/${name}`, version, path)) : [],
  );
}

function manifestReferences(contents: string, path: string): Reference[] {
  const manifest = parsePackageManifest(contents);
  const declared = declaredDependencies(manifest);
  const lines = new Map<string, number>();
  visit(contents, {
    onObjectProperty(name, _offset, _length, line, _column, pathSupplier) {
      const section = declared.get(name)?.section;
      if (section === undefined) return;
      const parent = pathSupplier();
      if (parent.length === 1 && parent[0] === section) lines.set(name, line + 1);
    },
  });
  const references: Reference[] = [];
  for (const [name, { range }] of declared) {
    if (typeof range !== "string") continue;
    const alias = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(range);
    const component = alias?.[1] ?? name;
    if (!npmName.test(component)) continue;
    const specifier = (alias?.[2] ?? range).trim();
    const version = semver.valid(specifier.replace(/^(?:\^|~|>=\s*)/, "")) ?? undefined;
    references.push(reference(`pkg:npm/${component}`, version, path, lines.get(name) ?? 1));
  }
  const runtime = manifest.volta?.node ?? manifest.engines?.node;
  if (typeof runtime === "string") {
    const range = runtime.trim() ? semver.validRange(runtime) : null;
    references.push({
      ...reference("pkg:generic/nodejs", range ? semver.minVersion(range)?.version : undefined, path),
      runtime: { kind: "node-manifest", range: runtime },
    });
  }
  return references;
}

function readLockfile(contents: string, lock: Record<string, unknown>, path: string): Reference[] {
  const { lockfileVersion, packages, dependencies } = lock;
  if (lockfileVersion === 1) {
    if (dependencies !== undefined && !isRecord(dependencies)) {
      throw new Error("Choose an npm lockfile with an object of resolved dependencies.");
    }
    return legacyLockReferences(contents, path);
  }
  if ((lockfileVersion !== 2 && lockfileVersion !== 3) || !isRecord(packages)) {
    throw new Error("Choose a package-lock.json with lockfileVersion 1, 2 or 3.");
  }
  return lockReferences(packages, path);
}

export function parseNpm(contents: string, path?: string): Reference[] {
  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed)) throw new Error("Choose a JSON object from package.json or package-lock.json.");
  if (parsed.lockfileVersion === undefined && !/(?:^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/i.test(path ?? "")) {
    return manifestReferences(contents, path ?? "package.json");
  }
  return readLockfile(contents, parsed, path ?? "package-lock.json");
}
