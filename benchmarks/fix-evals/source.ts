import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { isSafeTreePath } from "../../src/fleet/git.js";
import { fixtureFiles, writeFixture } from "../../src/fix/kit/fixture.js";

const execute = promisify(execFile);
const safeGitArgs = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.protectHFS=true",
  "-c",
  "core.protectNTFS=true",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "init.templateDir=",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "http.followRedirects=false",
];

async function git(root: string, args: readonly string[], input?: string): Promise<string> {
  const child = execute("git", [...safeGitArgs, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CEILING_DIRECTORIES: dirname(root),
      GIT_TERMINAL_PROMPT: "0",
    },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  child.child.stdin?.on("error", () => {});
  child.child.stdin?.end(input);
  try {
    return (await child).stdout;
  } catch (error) {
    throw new Error(`git ${args[0]} failed.`, { cause: error });
  }
}

function checkTree(tree: string): void {
  const seen = new Map<string, string>();
  for (const entry of tree.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/u.test(entry.slice(0, tab)) || !isSafeTreePath(path)) {
      throw new Error("The pinned tree contains a link, submodule, or unsupported path.");
    }
    // APFS and NTFS may fold names. Check parent directories as well as leaf names.
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const segment = parts.slice(0, i).join("/");
      const normalized = segment.normalize("NFC").toLowerCase();
      const previous = seen.get(normalized);
      if (previous !== undefined && previous !== segment) throw new Error("The pinned tree has colliding paths.");
      seen.set(normalized, segment);
    }
  }
}

export async function checkoutPublic(root: string, repository: string, commit: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/iu.test(repository) || !/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Expected a public GitHub owner/repository and full lowercase commit.");
  }
  await git(root, ["init", "--quiet"]);
  await git(root, ["fetch", "--quiet", "--depth=1", "--no-tags", `https://github.com/${repository}.git`, commit]);
  if ((await git(root, ["rev-parse", "FETCH_HEAD"])).trim() !== commit) throw new Error("Pinned commit did not match.");
  checkTree(await git(root, ["ls-tree", "-r", "-z", commit]));
  await git(root, ["checkout", "--quiet", "--detach", commit]);
  await rm(join(root, ".git"), { recursive: true });
}

export async function applyDiff(root: string, diff: string): Promise<void> {
  await git(root, ["apply", "--no-index", "--whitespace=nowarn", "-"], diff);
}

export async function fixtureSource(root: string, fixture: string): Promise<void> {
  await writeFixture(root, await fixtureFiles(fixture, true));
}

export async function tempSource<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "offing-fix-eval-")));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
