import { lstat, mkdtemp, realpath, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import process from "node:process";

import { readJsonFile, record } from "../agent-drivers/result.js";
import { git } from "../fix/git.js";
import { OffingError } from "../offing-error.js";
import { childEnvironments } from "./limits/secrets.js";
import type { AutopilotRun } from "./state.js";

export const runIdPattern = /^[A-Za-z0-9]{6}$/;
const prefix = "offing-autopilot-";
const recordName = "autopilot-run.v1.json";
const branchPrefix = "offing/autopilot/";

type Git = (root: string, ...args: string[]) => Promise<string>;

function restrictedGit(): Git {
  const env = {
    ...childEnvironments(process.env, "replay", []).tests,
    GIT_ALLOW_PROTOCOL: "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const flags = [
    "-c",
    `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "submodule.recurse=false",
  ];
  return (root, ...args) => git(root, [...flags, ...args], undefined, env);
}

async function withoutFilters(git: Git, root: string): Promise<Git> {
  const keys = await git(root, "config", "--null", "--name-only", "--list");
  const filters = new Set<string>();
  for (const key of keys.split("\0")) {
    const match = /^(filter\..+)\.(?:clean|smudge|process|required)$/s.exec(key);
    if (match?.[1]) filters.add(match[1]);
  }
  const overrides = [...filters].flatMap((filter) =>
    ["clean=", "smudge=", "process=", "required=false"].flatMap((setting) => ["-c", `${filter}.${setting}`]),
  );
  return (cwd, ...args) => git(cwd, ...overrides, ...args);
}

async function repositoryRoot(git: Git, path: string): Promise<string> {
  const root = await git(path, "rev-parse", "--show-toplevel").catch(() => "");
  if (!root) throw new OffingError("invalid-argument", "Autopilot requires a Git working tree.");
  return realpath(root.slice(0, -1));
}

function dirtyTree(): never {
  throw new OffingError("invalid-argument", "Autopilot requires a clean working tree. Commit or stash changes first.");
}

function runLocation(directory: string, id: string) {
  return {
    directory,
    tree: join(directory, "checkout"),
    record: join(directory, recordName),
    branch: branchPrefix + id,
    id,
  };
}

async function saveRecord(file: string, run: AutopilotRun): Promise<void> {
  const pending = file + ".tmp";
  try {
    await writeFile(pending, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(pending, file);
  } finally {
    await rm(pending, { force: true });
  }
}

async function removeRunTree(git: Git, root: string, path: string): Promise<void> {
  if (await git(path, "status", "--porcelain", "--untracked-files=all", "--ignored", "--ignore-submodules=none")) {
    throw new OffingError("invalid-argument", "Autopilot cannot remove a worktree with local changes.");
  }
  await git(root, "worktree", "remove", path);
}

async function deleteRunBranch(git: Git, root: string, branch: string, baseCommit: string): Promise<void> {
  const ref = "refs/heads/" + branch;
  const registered = await git(root, "worktree", "list", "--porcelain", "-z");
  if (registered.split("\0").includes("branch " + ref)) {
    throw new OffingError("invalid-argument", `Autopilot left the checked-out branch ${branch} intact.`);
  }
  await git(root, "update-ref", "-d", ref, baseCommit).catch(() => {
    throw new OffingError("invalid-argument", `Autopilot could not remove ${branch} at its recorded commit.`);
  });
}

export async function withAutopilotWorktree(path: string, run: AutopilotRun, prepare: (tree: string) => Promise<void>) {
  const localGit = restrictedGit();
  const root = await repositoryRoot(localGit, path);
  const git = await withoutFilters(localGit, root);
  if (await git(root, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none")) dirtyTree();
  const baseCommit = (await git(root, "rev-parse", "--verify", "HEAD^{commit}").catch(() => "")).trim();
  if (!baseCommit) throw new OffingError("invalid-argument", "Autopilot requires a committed Git HEAD.");
  const directory = await mkdtemp(join(await realpath(tmpdir()), prefix));
  const location = runLocation(directory, basename(directory).slice(prefix.length));
  let branchCreated = false;
  let treeCreated = false;
  try {
    await git(root, "branch", location.branch, baseCommit);
    branchCreated = true;
    await git(root, "worktree", "add", "--quiet", location.tree, location.branch);
    treeCreated = true;
    run.checkout = { id: location.id, branch: location.branch, baseCommit };
    await prepare(location.tree);
    await saveRecord(location.record, run);
    return location;
  } catch (error) {
    try {
      if (treeCreated) await removeRunTree(git, root, location.tree);
      if (branchCreated) await deleteRunBranch(git, root, location.branch, baseCommit);
      await rmdir(directory);
    } catch {
      throw new OffingError(
        "invalid-argument",
        `Preparation stopped. Review ${location.branch} and ${directory} before cleanup.`,
      );
    }
    throw error;
  }
}

async function readBaseCommit(location: ReturnType<typeof runLocation>): Promise<string> {
  if (!(await lstat(location.directory)).isDirectory() || !(await lstat(location.record)).isFile()) {
    throw new Error("Invalid run record.");
  }
  const raw = record(await readJsonFile(location.record, 1024 * 1024));
  const checkout = record(raw?.checkout);
  if (
    raw?.schemaVersion !== "offing.autopilot-run.v1" ||
    raw.mode !== "prepare" ||
    checkout?.id !== location.id ||
    checkout.branch !== location.branch ||
    typeof checkout.baseCommit !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(checkout.baseCommit)
  ) {
    throw new Error("Invalid run record.");
  }
  return checkout.baseCommit;
}

async function registeredTrees(git: Git, root: string, temporary: string) {
  const output = await git(root, "worktree", "list", "--porcelain", "-z");
  return output.split("\0\0").flatMap((entry) => {
    const fields = entry.split("\0");
    const ref = fields.find((field) => field.startsWith("branch refs/heads/" + branchPrefix));
    const id = ref?.slice("branch refs/heads/".length + branchPrefix.length);
    if (id === undefined || !runIdPattern.test(id)) return [];
    const location = runLocation(join(temporary, prefix + id), id);
    const tree = fields[0]?.slice("worktree ".length);
    if (tree === undefined || relative(tree, location.tree) !== "") return [];
    return [location];
  });
}

export async function undoAutopilotWorktree(path: string, id: string | undefined): Promise<string> {
  const localGit = restrictedGit();
  const root = await repositoryRoot(localGit, path);
  const git = await withoutFilters(localGit, root);
  const trees = await registeredTrees(git, root, await realpath(tmpdir()));
  const location = id === undefined && trees.length === 1 ? trees[0] : trees.find((tree) => tree.id === id);
  if (!location) {
    const detail =
      trees.length > 1 && id === undefined ? ` Choose a run ID: ${trees.map((tree) => tree.id).join(", ")}.` : "";
    throw new OffingError("invalid-argument", `No unique prepared Autopilot worktree found.${detail}`);
  }
  const baseCommit = await readBaseCommit(location).catch(() => undefined);
  if (
    !baseCommit ||
    !(await lstat(location.tree).catch(() => undefined))?.isDirectory() ||
    (await git(location.tree, "symbolic-ref", "-q", "HEAD").catch(() => "")).trim() !==
      "refs/heads/" + location.branch ||
    (await git(location.tree, "rev-parse", "HEAD")).trim() !== baseCommit
  ) {
    throw new OffingError("invalid-argument", "Autopilot cannot undo a missing or advanced prepared run.");
  }
  await removeRunTree(git, root, location.tree);
  await deleteRunBranch(git, root, location.branch, baseCommit);
  await unlink(location.record);
  await rmdir(location.directory);
  return location.branch;
}
