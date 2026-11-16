import { collectPyprojectDependencies, collectPyprojectRuntime } from "../../src/detectors/python/parse-pyproject.js";
import type { DirectDependency } from "../../src/detectors/python/types.js";
import { parseRequirement, parseTomlDocument } from "../../src/detectors/python/shared.js";
import { compareVersions, matchesSpecifier, parseVersion } from "../../src/upgrade/pep440.js";
import type { ParsedVersion } from "../../src/upgrade/pep440.js";
import { reference } from "./references.js";
import type { Reference } from "./references.js";

/** Use only a written version that satisfies the complete specifier. */
function minimumVersion(constraint: string): string | undefined {
  let best: { text: string; version: ParsedVersion } | undefined;
  for (const clause of constraint.split(",")) {
    const text = clause.trim().replace(/^(?:===?|>=|~=|\^|~)\s*/, "");
    const version = parseVersion(text);
    if (!version || matchesSpecifier(constraint, text) !== true) continue;
    if (!best || compareVersions(version, best.version) < 0) best = { text, version };
  }
  return best?.text;
}

export function parseRequirements(contents: string, path = "requirements.txt"): Reference[] {
  const references: Reference[] = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const requirement = parseRequirement(line.replace(/\s+#.*$/, ""));
    if (!requirement) continue;
    references.push(reference(`pkg:pypi/${requirement.name}`, minimumVersion(requirement.constraint), path, index + 1));
  }
  return references;
}

export function parsePyproject(contents: string, path = "pyproject.toml"): Reference[] {
  const document = parseTomlDocument(contents);
  if (!document) throw new Error("Choose a valid pyproject.toml file.");
  const dependencies = new Map<string, DirectDependency>();
  collectPyprojectDependencies(path, contents, document, dependencies, new Map());
  return [
    ...[...dependencies.values()].map(({ name, constraint, line }) =>
      reference(`pkg:pypi/${name}`, minimumVersion(constraint), path, line),
    ),
    ...collectPyprojectRuntime(path, contents, document).map(({ value, line }) =>
      reference("pkg:generic/python", minimumVersion(value), path, line),
    ),
  ];
}
