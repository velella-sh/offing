import process from "node:process";
import { parseArgs } from "node:util";

import {
  type CampaignState,
  publicationUrl,
  readCampaign,
  readCampaignFleet,
  readCampaignState,
} from "../campaign/document.js";
import { planCampaign } from "../campaign/select.js";
import { OffingError } from "../offing-error.js";
import type { CliCommand, CommandContext } from "./types.js";

const usage = [
  "  offing campaign plan <campaign.yml> --fleet <fleet.json> [--json]  # preview a pinned migration",
  "  offing campaign status <state.json> [--json]  # read recorded campaign state",
  "  offing campaign run <state.json> --inputs <local.json> [--one-batch] [--json]  # replay approved checkouts",
  "  offing campaign publish <state.json> --hosts <approval.json> [--one-batch] [--json]",
  "  offing campaign refresh <state.json> --hosts <approval.json> [--json]",
  "  offing campaign track <state.json> --operations <approval.json> [--json]",
  "  offing campaign pause|resume <state.json> [--json]",
  "  offing campaign cancel <state.json> [--hosts <approval.json>] [--json]",
  "  offing campaign retry <state.json> <repository|--failed> [--json]",
];

function render(state: CampaignState): string {
  const lines = [`Campaign ${state.id} (${state.asOf})`];
  if (state.target) lines.push(`Target: ${state.target.runtime}@${state.target.version}`);
  if (state.rollout) lines.push(state.rollout.reason ?? `Campaign ${state.rollout.state}.`);
  for (const row of state.repositories) {
    lines.push(`Batch ${row.batch} · ${row.host}/${row.name} @ ${row.commit} · ${row.status}`);
    if (row.run) lines.push(`  Autopilot run: ${row.run}`);
    const link = publicationUrl(row);
    if (link) lines.push(`  Review: ${link}`);
    const observed = row.publication?.observed;
    if (observed)
      lines.push(`  Host checks: ${observed.checks} · Review: ${observed.review} · Observed: ${observed.at}`);
    if (row.reason) lines.push(`  Outcome: ${row.reason}`);
    lines.push(`  Codemods: ${row.codemods?.join(", ") || (row.codemods === null ? "not recorded" : "none")}`);
    if (row.checks?.length) {
      for (const check of row.checks) lines.push(`  ${check.kind}: ${JSON.stringify(check.command)}`);
    } else {
      lines.push(`  Checks: ${row.checks === null ? "not recorded" : "none detected"}`);
    }
  }
  for (const row of state.omissions) lines.push(`Omitted ${row.host}/${row.name} · ${row.reason}`);
  return lines.join("\n");
}

const options = {
  fleet: { type: "string" },
  json: { type: "boolean" },
  inputs: { type: "string" },
  hosts: { type: "string" },
  operations: { type: "string" },
  "one-batch": { type: "boolean" },
  failed: { type: "boolean" },
} as const;

function parse(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options });
}

function write(state: CampaignState, json?: boolean, message?: string): number {
  const text = json
    ? JSON.stringify(state, null, 2)
    : [render(state), message === state.rollout?.reason ? undefined : message].filter(Boolean).join("\n");
  process.stdout.write(text + "\n");
  if (json && message) process.stderr.write(message + "\n");
  return 0;
}

function notUsed(values: ReturnType<typeof parse>["values"]): boolean {
  return (
    values.inputs === undefined &&
    values.hosts === undefined &&
    values.operations === undefined &&
    !values["one-batch"] &&
    !values.failed
  );
}

type Values = ReturnType<typeof parse>["values"];
type Execution = typeof import("../campaign/run.js");

function badUsage(ctx: CommandContext) {
  return ctx.fail("usage", usage.join("\n"));
}

async function track(execution: Execution, file: string, approval: string, json?: boolean) {
  const { readOperationsPermission } = await import("../campaign/host-config.js");
  const { trackCampaign } = await import("../campaign/tracking.js");
  const scope = await readOperationsPermission(approval);
  return execution.updateCampaign(file, async (state) => {
    const url = await trackCampaign(state, scope);
    process.stdout.write((json ? JSON.stringify({ url }) : url) + "\n");
    return 0;
  });
}

async function hostCommand(
  execution: Execution,
  action: string | undefined,
  file: string,
  values: Values,
  ctx: CommandContext,
) {
  if (values.operations !== undefined) {
    if (action !== "track" || !values.operations || values.hosts !== undefined || values["one-batch"]) {
      return badUsage(ctx);
    }
    return track(execution, file, values.operations, values.json);
  }
  if (
    !values.hosts ||
    (action !== "publish" && action !== "refresh" && action !== "cancel") ||
    (values["one-batch"] && action !== "publish")
  ) {
    return badUsage(ctx);
  }
  const { readHostPermissions } = await import("../campaign/host-config.js");
  const { managePublication } = await import("../campaign/publication.js");
  const permissions = await readHostPermissions(values.hosts);
  return execution.updateCampaign(file, async (state, save) => {
    const message = await managePublication(action, state, permissions, save, values["one-batch"] ?? false);
    return write(state, values.json, message);
  });
}

async function localCommand(
  execution: Execution,
  action: string | undefined,
  file: string,
  repository: string | undefined,
  values: Values,
  ctx: CommandContext,
) {
  if (action === "run" && repository === undefined && values.inputs && !values.failed) {
    const inputs = await execution.readRunInputs(values.inputs);
    return execution.updateCampaign(file, async (state, save) => {
      const message = await execution.runCampaign(
        state,
        execution.localCampaign(state, inputs),
        save,
        values["one-batch"] ?? false,
      );
      return write(state, values.json, message);
    });
  }
  if (action !== "pause" && action !== "resume" && action !== "retry" && action !== "cancel") return badUsage(ctx);
  const goodTarget =
    action === "retry" ? Boolean(repository) !== Boolean(values.failed) : !repository && !values.failed;
  if (values.inputs !== undefined || values["one-batch"] || !goodTarget) return badUsage(ctx);
  return execution.updateCampaign(file, async (state, save) => {
    execution.controlCampaign(state, action, repository);
    await save();
    return write(state, values.json);
  });
}

async function mutate(
  action: string | undefined,
  file: string,
  repository: string | undefined,
  values: Values,
  ctx: CommandContext,
): Promise<number> {
  if (values.fleet !== undefined) return badUsage(ctx);
  const execution = await import("../campaign/run.js");
  if (values.operations !== undefined || values.hosts !== undefined) {
    if (repository !== undefined || values.inputs !== undefined || values.failed) return badUsage(ctx);
    return hostCommand(execution, action, file, values, ctx);
  }
  return localCommand(execution, action, file, repository, values, ctx);
}

async function run(args: string[], ctx: CommandContext): Promise<number> {
  try {
    const { values, positionals } = parse(args);
    const [action, file, repository] = positionals;
    if (!file || positionals.length > 3) return ctx.fail("usage", usage.join("\n"));
    if (repository === undefined && notUsed(values)) {
      if (action === "plan" && values.fleet) {
        const [campaign, fleet] = await Promise.all([readCampaign(file), readCampaignFleet(values.fleet)]);
        return write(planCampaign(campaign, fleet), values.json);
      }
      if (action === "status" && values.fleet === undefined) {
        return write(await readCampaignState(file), values.json);
      }
    }
    return await mutate(action, file, repository, values, ctx);
  } catch (error) {
    if (error instanceof OffingError) return ctx.fail("usage", error.message);
    if (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) {
      return ctx.fail("usage", "Unknown campaign option or missing option value.");
    }
    throw error;
  }
}

export const command: CliCommand = {
  name: "campaign",
  flags: ["--fleet", "--json", "--inputs", "--hosts", "--operations", "--one-batch", "--failed"],
  example: "offing campaign plan campaign.yml --fleet fleet.json",
  usage,
  run,
};
