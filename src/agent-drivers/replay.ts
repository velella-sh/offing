import { lstat, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { type AgentDriver, type AgentRunInput, makeResult } from "./contract.js";
import { readJsonFile, record, validPaths } from "./result.js";

const success = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };

function edits(value: unknown): Array<[string, string]> {
  const turn = record(value);
  if (!turn) throw new Error("Invalid replay turn.");
  const entries = Object.entries(turn);
  if (!validPaths(entries.map(([path]) => path))) throw new Error("Invalid replay file path.");
  return entries.map(([path, content]) => {
    if (typeof content !== "string") throw new Error("Replay file content must be text.");
    return [path, content];
  });
}

async function inside(root: string, path: string): Promise<boolean> {
  const father = dirname(join(root, path));
  return relative(root, await realpath(father)) === relative(root, father);
}

async function destinationMode(path: string): Promise<number | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("Replay target must be a regular file.");
    return info.mode & 0o777;
  } catch (error) {
    if (record(error)?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function write(path: string, content: string): Promise<void> {
  const mode = await destinationMode(path);
  const temporary = await mkdtemp(join(dirname(path), ".offing-replay-"));
  const file = join(temporary, "content");
  try {
    await writeFile(file, content, { encoding: "utf8", ...(mode === undefined ? {} : { mode }) });
    await rename(file, path);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function plan(file: string, input: AgentRunInput) {
  const snapshot = record(await readJsonFile(file, 8 * 1024 * 1024));
  if (snapshot?.schemaVersion !== "offing.agent-replay.v1" || !Array.isArray(snapshot.turns)) {
    throw new Error("Expected offing.agent-replay.v1 turns.");
  }
  const root = await realpath(input.worktreePath);
  const turns = snapshot.turns.map(edits);
  const paths = [...new Set(turns.flatMap((turn) => turn.map(([path]) => path)))].sort();
  const allowed = new Set(input.allowedPaths ?? []);
  for (const path of paths) {
    if (!allowed.has(path) || !(await inside(root, path)))
      throw new Error(`Replay attempted a write outside its scope: ${path}`);
    await destinationMode(join(root, path));
  }
  return { root, paths, turns };
}

export function createReplayDriver(file: string): AgentDriver {
  return {
    name: "replay",
    detect: () => Promise.resolve(true),
    version: () => Promise.resolve("1"),
    async run(input) {
      const driver = { name: "replay", version: "1" };
      try {
        const { root, paths, turns } = await plan(file, input);
        for (const turn of turns) {
          for (const [path, content] of turn) await write(join(root, path), content);
        }
        return { ...success, result: makeResult(driver, success, paths, undefined, turns.length) };
      } catch (error) {
        const output = { ...success, exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
        return { ...output, result: { ...makeResult(driver, output), status: "blocked" } };
      }
    },
  };
}
