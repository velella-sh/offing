import { posix } from "node:path";

import { packageNameFromNodeModulesPath } from "../detectors/npm/lockfiles/package-lock.js";
import { lockedChain, object, sections, type LockedGraph, type RecordValue } from "./lock-graph.js";

const dependencySections = ["dependencies", "optionalDependencies"];
const rootSections = [...dependencySections, "devDependencies"];

function packageRecords(text: string): RecordValue {
  try {
    return object(object(JSON.parse(text)).packages);
  } catch {
    return {};
  }
}

function installedPath(packages: RecordValue, parent: string, name: string): string | undefined {
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name === "." || name === "..") return undefined;
  let directory = parent;
  while (true) {
    if (posix.basename(directory) !== "node_modules") {
      const candidate = posix.join(directory, "node_modules", name);
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    const parentDirectory = posix.dirname(directory);
    if (directory === "" || parentDirectory === directory) return undefined;
    directory = parentDirectory;
  }
}

function installedDependencies(packages: RecordValue, parent: string, names: string[]): Set<string> {
  const paths = names.map((name) => installedPath(packages, parent, name));
  return new Set(paths.filter((path) => path !== undefined));
}

/** Follow installed paths so two locked copies of the same package cannot share each other's edges. */
export function npmPaths(text: string): (path: string) => string[] | undefined {
  const packages = packageRecords(text);
  const edges: LockedGraph["edges"] = new Map();
  const labels = new Map<string, string>();
  for (const [path, metadata] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || posix.normalize(path) !== path) continue;
    const name = packageNameFromNodeModulesPath(path);
    const entry = object(metadata);
    if (name === undefined || typeof entry.version !== "string") continue;
    labels.set(path, (typeof entry.name === "string" && entry.name !== "" ? entry.name : name) + "@" + entry.version);
    edges.set(path, installedDependencies(packages, path, sections(entry, dependencySections)));
  }
  const roots = [...installedDependencies(packages, "", sections(object(packages[""]), rootSections))];
  return (path) => lockedChain({ edges, roots, labels }, path);
}
