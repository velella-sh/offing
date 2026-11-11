import { parseArgs } from "node:util";

import type { CliCommand } from "./types.js";

const defaultWithinDays = 30;

interface RollbackReadinessArgs {
  readonly releaseRef: string;
  readonly candidates: readonly string[];
  readonly withinDays: number;
  readonly json: boolean;
}

export function parseRollbackReadinessArgs(args: readonly string[]): RollbackReadinessArgs | string {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        candidate: { type: "string", multiple: true },
        "within-days": { type: "string", multiple: true },
        json: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    if (error instanceof TypeError) return error.message;
    throw error;
  }

  const [releaseRef] = parsed.positionals;
  if (!releaseRef || parsed.positionals.length !== 1) return "Provide exactly one <release-ref>.";
  const candidates = parsed.values.candidate ?? [];
  if (candidates.length < 1 || candidates.length > 3) return "Provide one to three --candidate <tag> options.";
  if (candidates.some((tag) => tag.length === 0)) return "--candidate requires a non-empty tag.";
  if (new Set(candidates).size !== candidates.length) return "Duplicate --candidate tags are not allowed.";

  const windows = parsed.values["within-days"] ?? [];
  if (windows.length > 1) return "Provide --within-days at most once.";
  const window = windows[0] ?? String(defaultWithinDays);
  const withinDays = Number(window);
  if (!/^\d+$/.test(window) || !Number.isSafeInteger(withinDays)) {
    return "--within-days must be a non-negative safe integer.";
  }
  return { releaseRef, candidates, withinDays, json: parsed.values.json };
}

export const command: CliCommand = {
  name: "rollback-readiness",
  flags: ["--candidate", "--within-days", "--json"],
  example: "offing rollback-readiness v2.0.0 --candidate v1.9.0",
  usage: [
    "  offing rollback-readiness <release-ref> --candidate <tag> [--within-days <days>] [--json]",
    `    Repeat --candidate 1 to 3 times. --within-days defaults to ${defaultWithinDays}. Comparison is not yet available.`,
  ],
  run(args, ctx) {
    const parsed = parseRollbackReadinessArgs(args);
    if (typeof parsed === "string") return Promise.resolve(ctx.fail("usage", parsed));
    return Promise.resolve(ctx.fail("data", "Rollback readiness comparison is not yet available."));
  },
};
