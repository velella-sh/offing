import process from "node:process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { writeCampaignBoard } from "../campaign-board/export.js";
import { readCampaignState } from "../campaign/document.js";
import { OffingError } from "../offing-error.js";
import type { CliCommand, CommandContext } from "./types.js";

const usage = "  offing campaign-board <state.json> --out <dir>  # export recorded campaign progress";

async function run(args: string[], ctx: CommandContext): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { out: { type: "string" } } });
  } catch {
    return ctx.fail("usage", usage);
  }
  const [file] = parsed.positionals;
  const output = parsed.values.out;
  if (!file || parsed.positionals.length !== 1 || typeof output !== "string" || !output.trim()) {
    return ctx.fail("usage", usage);
  }
  try {
    await writeCampaignBoard(await readCampaignState(file), resolve(output));
  } catch (error) {
    if (error instanceof OffingError) return ctx.fail("usage", error.message);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["EEXIST", "ENOTEMPTY"].includes(String(error.code))
    ) {
      return ctx.fail("usage", "Choose a new output directory for the campaign board.");
    }
    throw error;
  }
  process.stdout.write("Exported campaign board data and page configuration.\n");
  return 0;
}

export const command: CliCommand = {
  name: "campaign-board",
  flags: ["--out"],
  example: "offing campaign-board state.json --out board",
  usage: [usage],
  run,
};
