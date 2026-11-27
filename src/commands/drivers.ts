import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createCommandAgent } from "../agent-drivers/command.js";
import { type AgentResult, type AgentRunInput, makeResult } from "../agent-drivers/contract.js";
import { listDrivers, vendorByName } from "../agent-drivers/index.js";
import { runProcess, type AgentRunOutput } from "../agent-drivers/process.js";
import { createReplayDriver } from "../agent-drivers/replay.js";
import { record } from "../agent-drivers/result.js";
import { git } from "../migrate/worktree.js";
import type { CliCommand } from "./types.js";

type CheckInput = AgentRunInput & { root: string };
type CheckCallback = (input: CheckInput, kind: string) => Promise<AgentRunOutput & { result: AgentResult }>;

async function initVendorRepo(worktree: string): Promise<void> {
  await git(["init", "-q"], worktree);
  await git(["add", "--", "example.txt"], worktree);
  await git(
    [
      "-c",
      "user.name=Offing",
      "-c",
      "user.email=offing@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Fixture",
    ],
    worktree,
  );
}

async function replayCase(input: CheckInput, kind: string) {
  if (kind === "timeout") {
    const output = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      cwd: input.worktreePath,
      timeoutMs: input.timeoutMs,
    });
    return { ...output, result: makeResult({ name: "replay", version: "1" }, output) };
  }
  const recording = join(input.root, "turns.json");
  const file = kind === "edit" ? "example.txt" : "../outside.txt";
  await writeFile(
    recording,
    JSON.stringify({ schemaVersion: "offing.agent-replay.v1", turns: [{ [file]: "after\n" }] }),
  );
  return createReplayDriver(recording).run(input);
}

function driverTest(target: string): CheckCallback {
  if (target === "replay") return replayCase;
  const driver = vendorByName(target);
  if (!driver) {
    if (target === "command") throw new Error("Provide the trusted shell command to test, quoted as one argument.");
    return (input) => createCommandAgent({ command: target, requireResult: true }).run(input);
  }
  return async (input) => {
    await initVendorRepo(input.worktreePath);
    return driver.run(input);
  };
}

const usage = ["  offing drivers list", "  offing drivers test <driver|command>"];

const conformance = new URL("../../../docs/spec/agent-driver/conformance/check.mjs", import.meta.url);

function isConformance(value: unknown): value is { checkDriver: (run: CheckCallback) => Promise<string> } {
  return typeof record(value)?.checkDriver === "function";
}

export const command: CliCommand = {
  name: "drivers",
  flags: [],
  completion: { subcommands: ["list", "test"] },
  example: "offing drivers test replay",
  usage,
  async run(args, ctx) {
    const [action, target, ...remaining] = args;
    if (action === "list" && target === undefined) {
      process.stdout.write(`${(await listDrivers()).join("\n")}\n`);
      return 0;
    }
    if (action !== "test" || !target?.trim() || remaining.length > 0) {
      return ctx.fail("usage", "Use drivers list or drivers test <driver|command>.", usage.join("\n"));
    }
    try {
      const loaded: unknown = await import(conformance.href);
      if (!isConformance(loaded)) throw new Error("Invalid agent driver conformance module.");
      process.stdout.write(`${await loaded.checkDriver(driverTest(target))}\n`);
      return 0;
    } catch (error) {
      return ctx.fail("policy", error instanceof Error ? error.message : String(error));
    }
  },
};
