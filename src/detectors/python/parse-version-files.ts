import { resolve } from "node:path";

import { relativePosix } from "../../paths.js";
import type { DetectorUnclassifiedReference } from "../../sdk.js";
import { MISE_FILES, miseDeclarations, noVersionData } from "../../version-files/mise.js";
import { parseToolVersionEntries } from "../../version-files/tool-versions.js";
import { parseCondaEnvironment } from "../../version-files/conda.js";
import { addDependency, addExactPin, parseRequirement } from "./shared.js";
import type { DirectDependency, ResolvedVersions } from "./types.js";
import type { Declaration } from "./types.js";
import { readOptional } from "../read-optional.js";

const PYTHON_PURL = "pkg:generic/python";
const MISE_PARSERS = new Map([
  [
    PYTHON_PURL,
    ({ value, line }: { value: string; line: number }) =>
      /^(?:python-)?\d+\.\d+(?:\.\d+)?$/i.test(value) ? [{ value, line }] : [],
  ],
]);

export async function collectVersionFiles(
  root: string,
  projectRoot: string,
  unclassified: DetectorUnclassifiedReference[],
): Promise<Declaration[]> {
  const declarations: Declaration[] = [];
  for (const name of [".python-version", "runtime.txt"] as const) {
    const path = resolve(projectRoot, name);
    const contents = await readOptional(path);
    for (const [index, rawLine] of (contents ?? "").split(/\r?\n/).entries()) {
      const value = rawLine.replace(/#.*$/, "").trim();
      if (/^(?:python-)?\d+\.\d+(?:\.\d+)?$/i.test(value)) {
        declarations.push({ path, line: index + 1, value, kind: "pinned runtime" });
      }
    }
  }
  const toolVersionsPath = resolve(projectRoot, ".tool-versions");
  const toolVersions = await readOptional(toolVersionsPath);
  for (const { tool, line, tail } of parseToolVersionEntries(toolVersions ?? "", { spacedComments: true })) {
    if (tool.toLowerCase() === "python" && tail)
      declarations.push({ path: toolVersionsPath, line, value: tail, kind: "pinned runtime" });
  }
  for (const name of MISE_FILES) {
    const path = resolve(projectRoot, name);
    const contents = await readOptional(path);
    if (contents === undefined) continue;
    for (const pin of miseDeclarations(relativePosix(root, path), contents, MISE_PARSERS, unclassified))
      declarations.push({ ...pin, path, kind: "pinned runtime" });
  }
  return declarations;
}

export async function collectCondaEnvironment(
  root: string,
  projectRoot: string,
  dependencies: Map<string, DirectDependency>,
  resolved: ResolvedVersions,
  unclassified: DetectorUnclassifiedReference[],
): Promise<Declaration[]> {
  const declarations: Declaration[] = [];
  for (const name of ["environment.yml", "environment.yaml"]) {
    const path = resolve(projectRoot, name);
    const contents = await readOptional(path);
    if (contents === undefined) continue;
    const environment = parseCondaEnvironment(contents);
    for (const { raw, version, operator, line } of environment.python) {
      if (!/^\d+\.\d+/.test(version) || ["<", "<=", "!="].includes(operator)) {
        unclassified.push(noVersionData(relativePosix(root, path), line, PYTHON_PURL, raw));
        continue;
      }
      const pinned = ["", "=", "=="].includes(operator) && !version.includes(",");
      const value = pinned ? version : `${operator === "=" ? "==" : operator}${version}`;
      declarations.push({ path, line, value, kind: pinned ? "pinned runtime" : "compatibility range" });
    }
    for (const { raw, line } of environment.pip) {
      const requirement = parseRequirement(raw);
      if (!requirement) continue;
      addDependency(dependencies, path, contents, requirement.name, requirement.constraint, line);
      addExactPin(resolved, requirement.name, requirement.constraint);
    }
  }
  return declarations;
}
