import { lstat, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { createBudget } from "../autopilot/limits/budget.js";
import type { AutopilotConfig } from "../autopilot/limits/config.js";
import { createPathScope } from "../autopilot/limits/scope.js";
import { childEnvironments } from "../autopilot/limits/secrets.js";
import type { MigrationPacket } from "../migration-packet.js";
import { type AgentDriver, type AgentRunInput, makeResult } from "./contract.js";
import { readJsonFile, record, validPaths } from "./result.js";

const success = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  signal: null,
  timedOut: false,
};

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
    await writeFile(file, content, {
      encoding: "utf8",
      ...(mode === undefined ? {} : { mode }),
    });
    await rename(file, path);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

interface ReplayGuardrails {
  config: AutopilotConfig;
  packets: readonly Pick<MigrationPacket, "affectedFiles">[];
  testFiles: readonly string[];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
}

function guardrails(options: ReplayGuardrails) {
  return {
    permits: createPathScope(options.config, options.packets, options.testFiles),
    budget: createBudget(options.config.budget, options.now),
    ...childEnvironments(options.environment ?? process.env, "replay", options.config.secretEnv),
  };
}

async function plan(file: string, input: AgentRunInput, guard?: ReturnType<typeof guardrails>) {
  const snapshot = record(await readJsonFile(file, 8 * 1024 * 1024));
  if (snapshot?.schemaVersion !== "offing.agent-replay.v1" || !Array.isArray(snapshot.turns)) {
    throw new Error("Expected offing.agent-replay.v1 turns.");
  }
  const root = await realpath(input.worktreePath);
  const turns = snapshot.turns.map(edits);
  const paths = [...new Set(turns.flatMap((turn) => turn.map(([path]) => path)))].sort();
  const allowed = input.allowedPaths && new Set(input.allowedPaths);
  if (
    guard &&
    turns.some((turn) => turn.some(([path, content]) => guard.containsSecret(path) || guard.containsSecret(content)))
  ) {
    throw new Error("Autopilot refused a secret in a replay turn.");
  }
  for (const path of paths) {
    const inScope = guard ? guard.permits(path) && (allowed?.has(path) ?? true) : allowed?.has(path);
    if (!inScope || !(await inside(root, path))) throw new Error(`Replay attempted a write outside its scope: ${path}`);
    await destinationMode(join(root, path));
  }
  return { root, turns };
}

export function createReplayDriver(file: string, options?: ReplayGuardrails): AgentDriver {
  return {
    name: "replay",
    detect: () => Promise.resolve(true),
    version: () => Promise.resolve("1"),
    async run(input) {
      const driver = { name: "replay", version: "1" };
      const guard = options && guardrails(options);
      const applied = new Set<string>();
      let completed = 0;
      try {
        const { root, turns } = await plan(file, input, guard);
        for (const turn of turns) {
          const permit = guard?.budget.begin();
          if (permit && "stop" in permit) throw new Error("Autopilot budget stopped the run at " + permit.stop + ".");
          for (const [path, content] of turn) {
            await write(join(root, path), content);
            applied.add(path);
          }
          const stop = permit?.finish({ turns: 1, tokens: 0, costCents: 0 });
          if (stop) throw new Error("Autopilot budget stopped the run at " + stop + ".");
          completed += 1;
        }
        return {
          ...success,
          result: makeResult(driver, success, [...applied].sort(), undefined, completed),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const output = {
          ...success,
          exitCode: 1,
          stderr: guard ? guard.redact(message) : message,
        };
        const result = guard
          ? makeResult(driver, output, [...applied].sort(), undefined, completed)
          : makeResult(driver, output);
        return { ...output, result: { ...result, status: "blocked" } };
      }
    },
  };
}
