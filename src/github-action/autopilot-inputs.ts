import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile, record, validPaths } from "../agent-drivers/result.js";
import { parseAutopilotConfig, type Limits } from "../autopilot/limits/config.js";

export async function autopilotWorkspace(env: NodeJS.ProcessEnv) {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" && env.GITHUB_EVENT_NAME !== "schedule")
    throw new Error("Offing Autopilot requires an explicit workflow_dispatch or schedule on the default branch.");
  const event = env.GITHUB_EVENT_PATH && record(await readJsonFile(env.GITHUB_EVENT_PATH, 1024 * 1024));
  const repository = event ? record(event.repository) : undefined;
  const branch = repository?.default_branch;
  if (event && event.pull_request !== undefined) throw new Error("Offing Autopilot refuses pull request payloads.");
  if (typeof branch !== "string" || !branch || repository?.fork !== false || env.GITHUB_REF !== `refs/heads/${branch}`)
    throw new Error("Offing Autopilot requires the default branch of a non-fork repository.");
  if (repository.full_name !== undefined && repository.full_name !== env.GITHUB_REPOSITORY)
    throw new Error("Offing Autopilot requires the event repository to match GITHUB_REPOSITORY.");
  if (!env.GITHUB_WORKSPACE) throw new Error("Offing Autopilot requires a checked-out GITHUB_WORKSPACE.");
  return { root: env.GITHUB_WORKSPACE, branch };
}

function integer(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed)) throw new Error(`Set ${name} to a whole number.`);
  return parsed;
}

export function workflowBudget(env: NodeJS.ProcessEnv): Partial<Limits> {
  const run = {
    wallTimeMs: integer("autopilot-wall-time-ms", env["INPUT_AUTOPILOT-WALL-TIME-MS"]),
    turns: integer("autopilot-turns", env["INPUT_AUTOPILOT-TURNS"]),
    tokens: integer("autopilot-tokens", env["INPUT_AUTOPILOT-TOKENS"]),
    costCents: integer("autopilot-cost-cents", env["INPUT_AUTOPILOT-COST-CENTS"]),
  };
  parseAutopilotConfig({ budget: { run } });
  return Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined));
}

export function workflowWave(env: NodeJS.ProcessEnv): number {
  return integer("autopilot-wave", env["INPUT_AUTOPILOT-WAVE"]) ?? 0;
}

export function workflowDriver(env: NodeJS.ProcessEnv, key: string | undefined) {
  const agent = env.INPUT_AGENT || "claude";
  if (agent === "replay") {
    const recording = env["INPUT_AUTOPILOT-RECORDING"];
    if (recording && validPaths([recording])) return { recording };
    throw new Error("Set autopilot-recording to a committed, repository-relative replay file.");
  }
  if (agent !== "claude") throw new Error("Offing Autopilot agent must be claude or replay.");
  const name = env["INPUT_AGENT-KEY-SECRET"] || env.OFFING_ACTION_AUTOPILOT_SECRET_NAME;
  if (!name || !/^[A-Z_][A-Z0-9_]{0,99}$/u.test(name))
    throw new Error("Set agent-key-secret to the workflow's selected secret name.");
  if (!key?.trim())
    throw new Error(`Offing Autopilot needs the selected secret ${name}. Wire it to OFFING_ACTION_AUTOPILOT_KEY.`);
  return { claude: { key, path: env.PATH } };
}

export async function recordingFile(tree: string, recording: string): Promise<string> {
  const root = await realpath(tree);
  const path = resolve(root, recording);
  if ((await realpath(path).catch(() => "")) !== path)
    throw new Error("The committed Autopilot replay file is missing or uses a symlink.");
  return path;
}
