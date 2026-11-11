import { runScanPipeline } from "./runtime.js";
import type { CliCommand } from "./types.js";

export const command: CliCommand = {
  name: "scan",
  flags: [
    "--demo",
    "--json",
    "--format",
    "--baseline",
    "--baseline-warn-days",
    "--on-expired",
    "--today",
    "--write-status",
    "--interactive",
    "--fail-on",
    "--all",
    "--by-owner",
    "--data-version",
    "--only",
    "--exclude",
  ],
  example: "offing scan . --fail-on high",
  usage: [
    "  offing scan [path] [--no-cache] [--json | --format <text|json|markdown|junit|sarif|rdjson|codequality|compact|html|slack|teams|webhook|mermaid>]",
    "  offing scan --demo [--json | --format <text|json|markdown|junit|sarif|rdjson|codequality|compact|html|slack|teams|webhook|mermaid>]   # scan an in-memory demo project that always has findings",
    "  offing scan [path] --baseline <file> [--baseline <file>...] [--baseline-warn-days <n>] [--on-expired resurface|fail] [--today <YYYY-MM-DD>] [--json]",
    "  offing scan [path] --as-of <YYYY-MM-DD> [--json]   # scan as the world will look on a date; --today is an alias",
    "  offing scan [path] --min-support-days <n>   # warn on lines whose support ends within n days",
    "  offing scan [path] --write-status",
    "  offing scan [path] --interactive   # browse findings and open them in $EDITOR; plain text when not a terminal",
    "  offing scan [path] --fail-on <severity|none>   # exit 1 when a finding is at or above the severity",
    "  offing scan [path] --ignore <path>   # ignore paths or glob patterns during scan",
    "  offing scan [path] --only <ecosystem|rule-prefix>   # keep only matching findings; repeatable",
    "  offing scan [path] --exclude <ecosystem|rule-prefix>   # drop matching findings; repeatable",
    "  offing scan [path] --no-cache   # bypass the scan cache and re-scan all files fresh",
    "  offing scan <path> <path>... [--all <dir>] [--json]   # several projects, per-project and combined counts",
    "  offing scan [path] --by-owner [--json]   # group findings by CODEOWNERS owner; files with no owner are listed as unowned",
  ],
  usageSlots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 30],
  run(args, ctx) {
    return runScanPipeline("scan", args, ctx);
  },
};
