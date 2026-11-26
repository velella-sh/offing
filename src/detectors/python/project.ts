import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Declaration, DirectDependency, ProjectScan, ResolvedVersions } from "./types.js";
import { collectIniRuntime } from "./parse-ini.js";
import { collectLockfiles } from "./parse-lockfiles.js";
import { collectPyprojectDependencies, collectPyprojectRuntime } from "./parse-pyproject.js";
import { collectRequirementsFile, requirementFiles } from "./parse-requirements.js";
import { collectSetupRuntime } from "./parse-setup-py.js";
import type { DetectorUnclassifiedReference } from "../../sdk.js";
import { collectCondaEnvironment, collectVersionFiles } from "./parse-version-files.js";
import { readOptional } from "../read-optional.js";
import { parseTomlDocument } from "./shared.js";

/** Every declaration file in one project: version pins, setup.cfg, tox.ini, and setup.py. */
async function collectDeclarations(
  root: string,
  projectRoot: string,
  unclassified: DetectorUnclassifiedReference[],
): Promise<Declaration[]> {
  const declarations = await collectVersionFiles(root, projectRoot, unclassified);
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
export async function scanProject(
  root: string,
  directory: string,
  unclassified: DetectorUnclassifiedReference[],
): Promise<ProjectScan | undefined> {
  const projectRoot = resolve(root, directory);
  const pyprojectPath = resolve(projectRoot, "pyproject.toml");
  const pyprojectContents = await readOptional(pyprojectPath);
  const pyproject = pyprojectContents ? parseTomlDocument(pyprojectContents) : undefined;
  const requirements = await requirementFiles(projectRoot);
  const versionDeclarations = await collectDeclarations(root, projectRoot, unclassified);

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
  const conda = await collectCondaEnvironment(root, projectRoot, dependencies, resolved, unclassified);
  declarations.push(...conda);
  if (!pyprojectContents && requirements.length === 0 && declarations.length === 0 && dependencies.size === 0)
    return undefined;
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
