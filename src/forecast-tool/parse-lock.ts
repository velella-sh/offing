import { visit } from "jsonc-parser";
import semver from "semver";

import { classifyNodeVersion } from "../detectors/github-actions-node.js";
import { packageNameFromNodeModulesPath } from "../detectors/npm/lockfiles/package-lock.js";
import { declaredDependencies, parsePackageManifest } from "../detectors/npm/manifest.js";
import { record, reference } from "./references.js";
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
    const version = classifyNodeVersion(runtime.trim().replace(/^>=\s*/, ""));
    references.push(reference("pkg:generic/nodejs", version.kind === "versions" ? version.lowest : undefined, path));
  }
  return references;
}

export function parseNpm(contents: string, path?: string): Reference[] {
  const parsed: unknown = JSON.parse(contents);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Choose a JSON object from package.json or package-lock.json.");
  }
  const { lockfileVersion, packages } = record(parsed);
  if (lockfileVersion === undefined && !/^(package-lock\.json|npm-shrinkwrap\.json)$/i.test(path ?? "")) {
    return manifestReferences(contents, path ?? "package.json");
  }
  if (
    (lockfileVersion !== 2 && lockfileVersion !== 3) ||
    typeof packages !== "object" ||
    packages === null ||
    Array.isArray(packages)
  ) {
    throw new Error("Choose a package-lock.json with lockfileVersion 2 or 3.");
  }
  return lockReferences(record(packages), path ?? "package-lock.json");
}
