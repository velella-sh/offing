import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { FleetHostError, type FleetSelection } from "./host.js";

const execute = promisify(execFile);

export function isMissingGit(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function createGitEnv(credential: string | undefined) {
  const entries = Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"));
  return {
    ...Object.fromEntries(entries),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: credential === undefined ? "0" : "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: credential === undefined ? "" : `Authorization: Basic ${credential}`,
  };
}

async function git(directory: string, args: readonly string[], credential?: string): Promise<string> {
  try {
    const { stdout } = await execute(
      "git",
      [
        "-C",
        directory,
        "-c",
        "core.hooksPath=.git/offing-disabled-hooks",
        "-c",
        "init.templateDir=",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "protocol.http.allow=always",
        "-c",
        "http.followRedirects=false",
        "-c",
        "http.lowSpeedLimit=1000",
        "-c",
        "http.lowSpeedTime=30",
        ...args,
      ],
      { env: createGitEnv(credential), timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    return stdout;
  } catch (error) {
    if (isMissingGit(error)) throw error;
    throw new FleetHostError("Could not fetch the pinned Git tree. Check repository access and read permissions.");
  }
}

export function isSafeTreePath(path: string): boolean {
  return path.split("/").every(
    (part) =>
      part.length > 0 &&
      part !== "." &&
      part !== ".." &&
      part.toLowerCase() !== ".git" &&
      !/^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part) &&
      !Array.from(part).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || character === ":" || character === "\\";
      }) &&
      !part.endsWith(".") &&
      !part.endsWith(" "),
  );
}

/** Removes links and files matched only by gitignore patterns, leaving regular declared inputs. */
async function keepInputs(root: string, selection: FleetSelection, prefix = ""): Promise<void> {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(root, path);
    if (!isSafeTreePath(path) || (!entry.isDirectory() && (!entry.isFile() || !selection.includes(path)))) {
      await rm(full, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await keepInputs(root, selection, path);
    }
  }
}

async function size(path: string): Promise<number> {
  const entry = await lstat(path);
  if (!entry.isDirectory()) return entry.size;
  let bytes = 0;
  for (const child of await readdir(path)) bytes += await size(join(path, child));
  return bytes;
}

export async function fetchSparseTree(
  clone: URL,
  commit: string,
  directory: string,
  selection: FleetSelection,
  credential?: string,
): Promise<number> {
  await git(directory, ["init", "--quiet"]);
  await git(directory, ["remote", "add", "origin", clone.href]);
  await git(directory, ["config", "remote.origin.promisor", "true"]);
  await git(directory, ["config", "remote.origin.partialclonefilter", "blob:none"]);
  await git(directory, ["config", "core.sparseCheckout", "true"]);
  await git(directory, ["config", "core.sparseCheckoutCone", "false"]);
  const info = join(directory, ".git", "info");
  await mkdir(info, { recursive: true });
  await writeFile(join(info, "sparse-checkout"), `${selection.patterns.join("\n")}\n`);
  await git(directory, ["fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", commit], credential);
  await git(directory, ["checkout", "--quiet", "--detach", "FETCH_HEAD"], credential);
  const gitData = join(directory, ".git");
  const bytes = await size(join(gitData, "objects"));
  // Remove the promisor repository before the offline scanner can access it.
  await rm(gitData, { recursive: true, force: true });
  await keepInputs(directory, selection);
  return bytes;
}
