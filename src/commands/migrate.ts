import process from "node:process";
import { parseArgs } from "node:util";

import { vendorByName } from "../agent-drivers/index.js";
import { createReplayDriver } from "../agent-drivers/replay.js";
import { createCommandAgent, DEFAULT_AGENT_TIMEOUT_MS } from "../migrate/command-agent.js";
import { runMigrations } from "../migrate/index.js";
import type { CliCommand } from "./types.js";

const usage = [
  "  offing migrate <finding-id> [path] --driver <name> [--replay <recording>] [--timeout-ms <n>]",
  "  offing migrate <finding-id> [path] --agent <command> [--timeout-ms <n>]",
  "  offing migrate --from-refusals [path] --agent <command> [--timeout-ms <n>]",
];

function adapter(command: string | undefined, driver: string | undefined, replay: string | undefined) {
  if (driver === "replay" && replay?.trim() && command === undefined) return createReplayDriver(replay);
  if (replay !== undefined) throw new Error("Use --driver replay with --replay <recording>.");
  if (driver !== undefined) {
    if (command !== undefined) throw new Error("Use --agent or --driver.");
    const installed = vendorByName(driver);
    if (!installed) throw new Error(`Unknown driver: ${driver}.`);
    return installed;
  }
  if (!command?.trim()) throw new Error("Use --agent to name the command to run or select --driver.");
  return createCommandAgent({ command });
}

function argumentsFor(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      driver: { type: "string" },
      replay: { type: "string" },
      "from-refusals": { type: "boolean" },
      "timeout-ms": { type: "string" },
    },
  });
  const fromRefusals = values["from-refusals"] === true;
  const findingId = fromRefusals ? undefined : positionals[0];
  const path = positionals[fromRefusals ? 0 : 1] ?? ".";
  const timeout = values["timeout-ms"] === undefined ? DEFAULT_AGENT_TIMEOUT_MS : Number(values["timeout-ms"]);
  const agent = adapter(values.agent, values.driver, values.replay);
  if (!fromRefusals && !findingId) throw new Error("Provide a finding ID or use --from-refusals.");
  if (positionals.length > (fromRefusals ? 1 : 2)) throw new Error("Too many arguments for migrate.");
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error("--timeout-ms must be a positive integer no greater than 2147483647.");
  }
  return {
    path,
    ...(findingId === undefined ? {} : { findingId }),
    agent,
    timeoutMs: timeout,
  };
}

export const command: CliCommand = {
  name: "migrate",
  flags: ["--agent", "--driver", "--from-refusals", "--replay", "--timeout-ms"],
  example: "offing migrate <finding-id> --agent 'my-agent \"$OFFING_MIGRATION_PROMPT_FILE\"'",
  usage,
  async run(args, ctx) {
    let options: ReturnType<typeof argumentsFor>;
    try {
      options = argumentsFor(args);
    } catch (error) {
      return ctx.fail("usage", error instanceof Error ? error.message : String(error), usage.join("\n"));
    }
    const outcomes = await runMigrations(options);
    if (!outcomes.length) process.stdout.write("No findings without a deterministic fix.\n");
    for (const outcome of outcomes) {
      if (outcome.commit) {
        process.stdout.write(`Committed ${outcome.commit} on local branch ${outcome.branch}.\n`);
        process.stdout.write(`Verification result: ${outcome.receiptPath}\n`);
      }
      if (!outcome.resolved) {
        process.stderr.write(
          `${outcome.findingId}: ${outcome.error ?? "Review unresolved or introduced findings in the receipt."}\n`,
        );
      }
    }
    return outcomes.every((outcome) => outcome.resolved) ? 0 : ctx.exitCodes.policy;
  },
};
