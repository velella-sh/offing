import type { CliCommand } from "./types.js";

const usage = "offing codemod test <dir>";

export const command: CliCommand = {
  name: "codemod",
  flags: [],
  completion: { subcommands: ["test"] },
  example: "offing codemod test ./my-codemod",
  usage: [`  ${usage}    # check a codemod and its fixtures`],
  async run(args, ctx) {
    const [action, directory, ...rest] = args;
    if (action !== "test" || !directory?.trim() || directory.startsWith("-") || rest.length > 0) {
      return ctx.fail("usage", `Usage: ${usage}`);
    }
    try {
      const { testCodemod } = await import("../fix/kit/conformance.js");
      const { id, cases } = await testCodemod(directory);
      process.stdout.write(`${id}: passed ${cases.length} case(s) (${cases.join(", ")}).\n`);
      return 0;
    } catch (error) {
      return ctx.fail("policy", error instanceof Error ? error.message : String(error));
    }
  },
};
