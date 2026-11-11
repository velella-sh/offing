import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "completions",
  flags: [],
  example: "offing completions zsh > ~/.zfunc/_offing",
  usage: ["  offing completions <bash|zsh|fish>   # print a shell completion script"],
  usageSlots: [65],
  completion: { subcommands: ["bash", "zsh", "fish"] },
  run(args, ctx) {
    const script = args.length === 1 ? ctx.completionScript(args[0]) : undefined;
    if (script === undefined) return Promise.resolve(ctx.fail("usage", "Usage: offing completions <bash|zsh|fish>"));
    process.stdout.write(script);
    return Promise.resolve(0);
  },
};
