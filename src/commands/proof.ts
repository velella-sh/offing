import process from "node:process";
import { parseArgs } from "node:util";

import { OffingError } from "../offing-error.js";
import type { CliCommand, CommandContext } from "./types.js";

const usage = "offing proof verify <file> [--repo <path>]";

function inputs(args: string[]) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { repo: { type: "string" } } });
    const [action, file] = positionals;
    if (action === "verify" && file && positionals.length === 2 && values.repo !== "") {
      return { file, repo: values.repo ?? process.cwd() };
    }
  } catch {
    // Do not echo untrusted flags or values into the diagnostic.
  }
  return undefined;
}

async function run(args: string[], ctx: CommandContext): Promise<number> {
  const input = inputs(args);
  if (!input) return ctx.fail("usage", `Usage: ${usage}`);
  try {
    const { verifyProof } = await import("../proof/check.js");
    await verifyProof(input.file, input.repo);
  } catch (error) {
    if (error instanceof OffingError) return ctx.failError(error);
    throw error;
  }
  process.stdout.write("Proof verified against local Git and log evidence.\n");
  return 0;
}

export const command: CliCommand = {
  name: "proof",
  flags: ["--repo"],
  completion: { subcommands: ["verify"] },
  example: "offing proof verify offing-proof.json",
  usage: [`  ${usage}  # check a migration proof against local Git and log evidence`],
  run,
};
