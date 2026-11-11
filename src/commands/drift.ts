import { driftCommand } from "../drift/command.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "drift",
  flags: ["--json", "--check", "--runtime", "--align"],
  example: "offing drift . --check",
  usage: [
    "  offing drift [path] [--json] [--check] [--runtime <id>] [--align <release>]   # report every runtime version a repository states and whether they agree",
    "  offing drift [path] [--json] [--check] [--runtime <id>] [--align <release>]   # report runtime versions that disagree, per runtime; never writes a file",
    "  offing drift [path] [--json] [--check] [--runtime <id>] [--align <release>]   # report runtime versions that disagree; --align prints a patch and writes nothing",
    "  offing drift [path] [--json] [--check] [--runtime <id>] [--align <release>]   # report every runtime version a repository states and whether they agree",
  ],
  usageSlots: [21, 22, 27, 28],
  run(args) {
    return driftCommand(args);
  },
};
