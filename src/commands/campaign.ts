import process from "node:process";
import { parseArgs } from "node:util";

import { type CampaignState, readCampaign, readCampaignFleet, readCampaignState } from "../campaign/document.js";
import { planCampaign } from "../campaign/select.js";
import { OffingError } from "../offing-error.js";
import type { CliCommand, CommandContext } from "./types.js";

const usage = [
  "  offing campaign plan <campaign.yml> --fleet <fleet.json> [--json]  # preview a pinned migration",
  "  offing campaign status <state.json> [--json]  # read recorded campaign state",
];

function render(state: CampaignState): string {
  const lines = [`Campaign ${state.id} (${state.asOf})`];
  if (state.target) lines.push(`Target: ${state.target.runtime}@${state.target.version}`);
  for (const row of state.repositories) {
    lines.push(`Batch ${row.batch} · ${row.host}/${row.name} @ ${row.commit} · ${row.status}`);
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

async function run(args: string[], ctx: CommandContext): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { fleet: { type: "string" }, json: { type: "boolean" } },
    });
    const [action, file] = positionals;
    if (!file || positionals.length !== 2) return ctx.fail("usage", usage.join("\n"));
    let state: CampaignState;
    if (action === "plan" && values.fleet) {
      const [campaign, fleet] = await Promise.all([readCampaign(file), readCampaignFleet(values.fleet)]);
      state = planCampaign(campaign, fleet);
    } else if (action === "status" && values.fleet === undefined) {
      state = await readCampaignState(file);
    } else {
      return ctx.fail("usage", usage.join("\n"));
    }
    process.stdout.write(`${values.json ? JSON.stringify(state, null, 2) : render(state)}\n`);
    return 0;
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
  flags: ["--fleet", "--json"],
  example: "offing campaign plan campaign.yml --fleet fleet.json",
  usage,
  run,
};
