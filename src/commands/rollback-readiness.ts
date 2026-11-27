import process from "node:process";
import { configureActiveData } from "@velella/ebb/data-source";
import { parseArgs } from "node:util";

import type { CliCommand } from "./types.js";

const defaultWithinDays = 30;

interface RollbackReadinessArgs {
  readonly releaseRef: string;
  readonly candidates: readonly string[];
  readonly withinDays: number;
  readonly supportUntil?: string;
  readonly today?: string;
  readonly noData?: string;
  readonly json: boolean;
}

function candidateError(candidates: readonly string[]): string | undefined {
  if (candidates.length < 1 || candidates.length > 3) return "Provide one to three --candidate <tag> options.";
  if (candidates.some((tag) => tag.length === 0)) return "--candidate requires a non-empty tag.";
  if (new Set(candidates).size !== candidates.length) return "Duplicate --candidate tags are not allowed.";
  return undefined;
}

function parseWindow(windows: readonly string[], supportUntil: string | undefined): number | string {
  if (windows.length > 1) return "Provide --within-days at most once.";
  if (windows.length > 0 && supportUntil !== undefined) return "Choose one of --within-days and --support-until.";
  const value = windows[0] ?? String(defaultWithinDays);
  const days = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(days)
    ? days
    : "--within-days must be a non-negative safe integer.";
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
        "support-until": { type: "string" },
        today: { type: "string" },
        "no-data": { type: "string" },
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
  const error = candidateError(candidates);
  if (error) return error;
  const { "support-until": supportUntil, today, "no-data": noData, json } = parsed.values;
  const withinDays = parseWindow(parsed.values["within-days"] ?? [], supportUntil);
  if (typeof withinDays === "string") return withinDays;
  return {
    releaseRef,
    candidates,
    withinDays,
    json,
    ...(supportUntil === undefined ? {} : { supportUntil }),
    ...(today === undefined ? {} : { today }),
    ...(noData === undefined ? {} : { noData }),
  };
}

export const command: CliCommand = {
  name: "rollback-readiness",
  flags: ["--candidate", "--within-days", "--support-until", "--today", "--no-data", "--json"],
  example: "offing rollback-readiness v2.0.0 --candidate v1.9.0",
  usage: [
    "  offing rollback-readiness <release-ref> --candidate <tag> [--within-days <days> | --support-until <date>] [--today <date>] [--no-data fail|warn|ignore] [--json]",
    `    Repeat --candidate 1 to 3 times. --within-days defaults to ${defaultWithinDays}.`,
  ],
  async run(args, ctx) {
    const parsed = parseRollbackReadinessArgs(args);
    if (typeof parsed === "string") return ctx.fail("usage", parsed);
    const { gateReport, gateWindow } = await import("../release-gate/decision.js");
    const { evaluateRepository, verifyRef, verifyTag } = await import("../release-gate/inputs.js");
    const { renderGate } = await import("../release-gate/render.js");
    const { releaseRef, candidates, withinDays, supportUntil, noData, today, json } = parsed;
    const window = gateWindow(today ?? new Date().toISOString().slice(0, 10), withinDays, supportUntil, noData);
    const root = process.cwd();
    const pinnedVersion = process.env.OFFING_DATA_VERSION;
    configureActiveData(pinnedVersion ? { pinnedVersion } : {});
    verifyRef(root, releaseRef);
    const decisions = [];
    for (const target of candidates) {
      const commit = verifyTag(root, target);
      decisions.push(await evaluateRepository({ kind: "git-ref", target }, window, root, commit));
    }
    const report = gateReport(window, decisions, releaseRef);
    process.stdout.write(`${renderGate(report, json ? "json" : "text")}\n`);
    return decisions.some(({ verdict }) => verdict === "block") ? ctx.exitCodes.policy : 0;
  },
};
