import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Declaration, DirectDependency, ProjectScan, ResolvedVersions } from "./types.js";
import { collectIniRuntime } from "./parse-ini.js";
import { collectLockfiles } from "./parse-lockfiles.js";
import { collectPyprojectDependencies, collectPyprojectRuntime } from "./parse-pyproject.js";
import { collectRequirementsFile } from "./parse-requirements.js";
import { collectSetupRuntime } from "./parse-setup-py.js";
import { collectVersionFiles } from "./parse-version-files.js";
import { parseTomlDocument } from "./shared.js";
import { readOptional } from "../read-optional.js";

async function requirementFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^requirements(?:[-_.][A-Za-z0-9_.-]+)?\.txt$/i.test(entry.name))
      .map((entry) => resolve(root, entry.name))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Every declaration file in one project: version pins, setup.cfg, tox.ini, and setup.py. */
async function collectDeclarations(projectRoot: string): Promise<Declaration[]> {
  const declarations = await collectVersionFiles(projectRoot);
  for (const name of ["setup.cfg", "tox.ini"] as const) {
    const path = resolve(projectRoot, name);
    const contents = await readOptional(path);
    if (contents) declarations.push(...collectIniRuntime(path, contents, name));
  }
  const setupPath = resolve(projectRoot, "setup.py");
  const setupContents = await readOptional(setupPath);
  if (setupContents) declarations.push(...(await collectSetupRuntime(setupPath, setupContents)));
  return declarations;
}

/** Read one project directory; undefined when it has no pyproject, requirements, or version files. */
export async function scanProject(root: string, directory: string): Promise<ProjectScan | undefined> {
  const projectRoot = resolve(root, directory);
  const pyprojectPath = resolve(projectRoot, "pyproject.toml");
  const pyprojectContents = await readOptional(pyprojectPath);
  const pyproject = pyprojectContents ? parseTomlDocument(pyprojectContents) : undefined;
  const requirements = await requirementFiles(projectRoot);
  const versionDeclarations = await collectDeclarations(projectRoot);
  if (!pyprojectContents && requirements.length === 0 && versionDeclarations.length === 0) return undefined;

  const dependencies = new Map<string, DirectDependency>();
  const resolved: ResolvedVersions = new Map();
  const declarations =
    pyproject && pyprojectContents ? collectPyprojectRuntime(pyprojectPath, pyprojectContents, pyproject) : [];
  declarations.push(...versionDeclarations);
  if (pyproject && pyprojectContents)
    collectPyprojectDependencies(pyprojectPath, pyprojectContents, pyproject, dependencies, resolved);
  for (const path of requirements) {
    collectRequirementsFile(path, await readFile(path, "utf8"), dependencies, resolved);
  }
  await collectLockfiles(projectRoot, resolved);
  return { directory, declarations, dependencies, resolved };
}

/** A workspace shares the root's lockfile (uv.lock), so root-resolved versions apply to every project. */
export async function shareRootLockfile(root: string, projects: ProjectScan[]): Promise<void> {
  const rootResolved: ResolvedVersions = new Map();
  await collectLockfiles(root, rootResolved);
  for (const project of projects) {
    for (const [name, versions] of rootResolved)
      project.resolved.set(name, new Set([...(project.resolved.get(name) ?? []), ...versions]));
  }
}
