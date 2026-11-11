import { parsePromptArguments, promptUsage, runPrompt } from "../prompt-segment.js";
import type { CliCommand } from "./types.js";

/** `prompt`: a fast shell-prompt segment read from the scan cache; it never scans. */
export const command: CliCommand = {
  name: "prompt",
  flags: ["--format", "--symbol"],
  example: "offing prompt --symbol EOL:",
  usage: [
    "  offing prompt [path] [--format <text|json>] [--symbol <s>]   # shell prompt segment such as ⏳2, read from the scan cache only",
  ],
  run(args, ctx) {
    const parsed = parsePromptArguments(args);
    if (typeof parsed === "string") return Promise.resolve(ctx.fail("usage", parsed, `\n${promptUsage}`));
    return Promise.resolve(runPrompt(parsed));
  },
};
