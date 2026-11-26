import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import semver from "semver";

import type { ReplacementRequirements } from "./domain.js";
import { MISE_FILES, parseMisePins } from "./version-files/mise.js";
import { parseToolVersionEntries } from "./version-files/tool-versions.js";

/** The Node.js and Python versions a repository pins, as written in its files. */
export type PinnedRuntimes = ReplacementRequirements;

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Reads the runtimes a repository pins in its root files. Nothing is executed and no network is used. */
export async function readPinnedRuntimes(root: string): Promise<PinnedRuntimes> {
  const tools = parseToolVersionEntries((await readOptional(resolve(root, ".tool-versions"))) ?? "", {
    spacedComments: true,
  });
  const toolVersion = (name: string): string | undefined =>
    tools.find(({ tool, tail }) => tool.toLowerCase() === name && tail !== "")?.tail.split(/\s+/)[0];
  const mise = (await Promise.all(MISE_FILES.map((name) => readOptional(resolve(root, name))))).flatMap((contents) =>
    contents ? parseMisePins(contents) : [],
  );
  const miseVersion = (purl: string): string | undefined =>
    mise.find((pin) => pin.purl === purl && /^v?\d+(?:\.\d+){0,2}$/.test(pin.value))?.value;
  const node =
    (await readOptional(resolve(root, ".nvmrc")))?.trim() ||
    (await readOptional(resolve(root, ".node-version")))?.trim() ||
    toolVersion("nodejs") ||
    toolVersion("node") ||
    miseVersion("pkg:generic/nodejs");
  const python =
    (await readOptional(resolve(root, ".python-version")))?.trim() ||
    toolVersion("python") ||
    miseVersion("pkg:generic/python");
  return {
    ...(node && semver.coerce(node) ? { node } : {}),
    ...(python && semver.coerce(python) ? { python } : {}),
  };
}

/** True when the pinned version is lower than the minimum. A pin that is not a version, such as `lts/*`, never conflicts. */
export function isBelowRequirement(pinned: string, minimum: string): boolean {
  const have = semver.coerce(pinned);
  const need = semver.coerce(minimum);
  return have !== null && need !== null && semver.lt(have, need);
}

const RUNTIME_NAMES = { node: "Node.js", python: "Python" } as const;

/** One warning per runtime whose pinned version is below what the replacement needs. */
export function runtimeConflicts(
  replacement: string,
  requires: ReplacementRequirements,
  pinned: PinnedRuntimes,
): string[] {
  const warnings: string[] = [];
  for (const runtime of ["node", "python"] as const) {
    const minimum = requires[runtime];
    const have = pinned[runtime];
    if (minimum && have && isBelowRequirement(have, minimum)) {
      warnings.push(
        `Warning: ${replacement} requires ${RUNTIME_NAMES[runtime]} ${minimum} or newer, but this repository pins ${RUNTIME_NAMES[runtime]} ${have}. Upgrade the runtime first or choose another replacement.`,
      );
    }
  }
  return warnings;
}
