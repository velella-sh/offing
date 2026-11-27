import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { compareFindings, git, parseRange, type DiffResult } from "../diff.js";
import type { Finding } from "../domain.js";
import type { ScanFileSystem } from "../file-system.js";
import { nodeFileSystem } from "../node-file-system.js";
import { scanWithBuiltIns } from "../scan-builtins.js";

const maxFiles = 5_000;
const maxBytes = 64 * 1024 * 1024;
const maxTreeOutput = 2 * 1024 * 1024;
const regularBlob = /^100(?:644|755) blob ([0-9a-f]{40}) +(\d+)\t([\s\S]+)$/u;
const windowsDevice = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/iu;

interface GitBlob {
  object: string;
  bytes: number;
  path: string;
}

export function safeForkPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 1024 &&
    !/[:\\\uFFFD]/u.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    path
      .split("/")
      .every((part) => part && !/[ .]$/u.test(part) && part.toLowerCase() !== ".git" && !windowsDevice.test(part))
  );
}

function filesInTree(root: string, ref: string): GitBlob[] {
  const entries = git(root, ["ls-tree", "-r", "-z", "-l", ref, "--"], undefined, maxTreeOutput)
    .toString("utf8")
    .split("\0");
  const files: GitBlob[] = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry || entry.startsWith("120000 blob ") || entry.startsWith("160000 commit ")) continue;
    const fields = regularBlob.exec(entry);
    const object = fields?.[1];
    const path = fields?.[3];
    const bytes = Number(fields?.[2]);
    if (!object || !safeForkPath(path) || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("The fork tree contains an unsupported regular entry.");
    }
    total += bytes;
    files.push({ object, bytes, path });
    if (total > maxBytes || files.length > maxFiles)
      throw new Error("The complete fork tree exceeds the review budget.");
  }
  return files;
}

/** Write only exact regular Git blobs. Archives, symlinks, Git filters, and repo hooks have no part in this path. */
async function copyRegularTree(root: string, ref: string, destination: string): Promise<void> {
  const files = filesInTree(root, ref);
  if (files.length === 0) return;
  const requested = Buffer.from(files.map(({ object }) => object + "\n").join(""));
  const bytes = git(root, ["cat-file", "--batch"], requested, maxBytes + maxTreeOutput);
  let offset = 0;
  for (const file of files) {
    const headerEnd = bytes.indexOf(10, offset);
    const dataEnd = headerEnd + 1 + file.bytes;
    if (
      headerEnd < offset ||
      bytes.toString("ascii", offset, headerEnd) !== `${file.object} blob ${file.bytes}` ||
      bytes[dataEnd] !== 10
    )
      throw new Error("Git returned incomplete fork blob data.");
    const path = join(destination, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes.subarray(headerEnd + 1, dataEnd), { flag: "wx" });
    offset = dataEnd + 1;
  }
  if (offset !== bytes.length) throw new Error("Git returned unexpected fork blob data.");
}

function confinedReadOnly(root: string): ScanFileSystem {
  const inside = (path: string) => {
    const name = relative(root, resolve(path));
    return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
  };
  const confined = (path: string) => {
    if (!inside(path)) throw Object.assign(new Error("Path is outside the fork snapshot."), { code: "ENOENT" });
    return path;
  };
  const denyWrite = (): Promise<never> => Promise.reject(new Error("The fork snapshot is read-only."));
  return {
    readDirectory: async (path) => nodeFileSystem.readDirectory(confined(path)),
    readBytes: async (path) => nodeFileSystem.readBytes(confined(path)),
    readText: async (path) => nodeFileSystem.readText(confined(path)),
    size: async (path) => nodeFileSystem.size(confined(path)),
    stat: async (path) => nodeFileSystem.stat(confined(path)),
    realPath: async (path) => confined(await realpath(confined(path))),
    exists: async (path) => inside(path) && nodeFileSystem.exists(path),
    writeText: denyWrite,
    writeTextAtomically: denyWrite,
    copy: denyWrite,
    makeTemporaryDirectory: denyWrite,
    remove: denyWrite,
  };
}

async function scanTree(root: string, ref: string): Promise<Finding[]> {
  const destination = await mkdtemp(join(tmpdir(), "offing-fork-blobs-"));
  try {
    await copyRegularTree(root, ref, destination);
    const real = await realpath(destination);
    return (
      await scanWithBuiltIns(real, {
        noCache: true,
        cacheDirectory: join(real, ".offing-unused-cache"),
        fileSystem: confinedReadOnly(real),
      })
    ).findings;
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

export async function diffForkTrees(root: string, range: string): Promise<DiffResult> {
  const { base, head } = parseRange(range);
  const before = await scanTree(root, base);
  const after = await scanTree(root, head);
  return { schemaVersion: "offing.diff.v1", base, head, ...compareFindings(before, after) };
}
