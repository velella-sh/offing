import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { fixtureRealName } from "../../fixture-names.js";

const fixtureSuffix = ".fixture";
const workflowSuffix = ".workflow.fixture";

function realName(name: string): string {
  if (name.endsWith(workflowSuffix)) return name.slice(0, -workflowSuffix.length);
  const renamed = fixtureRealName(name);
  return renamed === name && name.endsWith(fixtureSuffix) ? name.slice(0, -fixtureSuffix.length) : renamed;
}

function fixtureName(name: string): string {
  if (name.toLowerCase() === ".git") throw new Error("Fixture trees cannot contain Git metadata.");
  if (!name || /[\p{Cc}:<>|"?*\\]|[. ]$/u.test(name)) {
    throw new Error(`Expected a portable fixture name: ${JSON.stringify(name)}`);
  }
  return name;
}

export async function fixtureFiles(directory: string, restoreNames: boolean): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  await collect(directory, "", files, restoreNames);
  return files;
}

async function collect(
  directory: string,
  prefix: string,
  files: Map<string, Buffer>,
  restoreNames: boolean,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const stored = fixtureName(entry.name);
    const path = join(directory, stored);
    if (entry.isDirectory()) {
      await collect(path, prefix + stored + "/", files, restoreNames);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Expected a regular fixture file at ${path}`);
    const name = prefix + (restoreNames ? fixtureName(realName(stored)) : stored);
    if (files.has(name)) throw new Error(`More than one fixture file resolves to ${name}`);
    files.set(name, await readFile(path));
  }
}

export async function writeFixture(root: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [name, bytes] of files) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
  }
}
