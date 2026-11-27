import { link, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import { DEFAULT_FORECAST_MONTHS, MAX_FORECAST_MONTHS } from "@velella/ebb/forecast";
import { buildRepositoryForecast, renderForecastText, replayScanOptions } from "../forecast.js";
import type { RepositoryForecast } from "../forecast.js";
import { renderForecastIcs } from "../forecast-ics.js";
import { renderForecastSvg } from "../forecast-svg.js";
import { renderForecastTimeline } from "../forecast-timeline.js";
import { renderForecastMermaid } from "../reporters.js";
import { scanWithBuiltIns } from "../scan-builtins.js";
import { fleetForecastFlags, runFleetForecast } from "./internal/fleet-forecast.js";
import type { Gated } from "./runtime.js";
import { afterGates, optionalFileOperand, preScanPhase, repositoryPhase } from "./runtime.js";
import type { CliCommand, CommandContext } from "./types.js";

/** The output modes forecast offers, and the severity flag that picks between them. */
interface ForecastModes {
  readonly ics: boolean;
  readonly svg: boolean;
  readonly animate: boolean;
  readonly timeline: boolean;
  readonly json: boolean;
  readonly format: string | undefined;
}

/** Two forecast flags that cannot mean one output, with the message the command prints for them. */
interface ForecastModeConflict {
  readonly message: string;
  readonly when: (modes: ForecastModes) => boolean;
}

/** The refused combinations in the order the command reports them. */
const forecastModeConflicts: readonly ForecastModeConflict[] = [
  {
    message: "--ics requires its own output mode.",
    when: (modes) =>
      modes.ics && (modes.svg || modes.animate || modes.timeline || modes.json || modes.format !== undefined),
  },
  { message: "--animate needs --svg.", when: (modes) => modes.animate && !modes.svg },
  { message: "Use either --svg or --json, not both.", when: (modes) => modes.svg && modes.json },
  { message: "Use either --timeline or --json, not both.", when: (modes) => modes.timeline && modes.json },
  { message: "Use either --svg or --timeline, not both.", when: (modes) => modes.svg && modes.timeline },
  {
    message: "Use either --timeline or --format mermaid, not both.",
    when: (modes) => modes.timeline && modes.format === "mermaid",
  },
];

/** The first combination of output modes forecast refuses; undefined when they fit together. */
function forecastModeFailure(modes: ForecastModes, ctx: CommandContext): number | undefined {
  for (const conflict of forecastModeConflicts) {
    if (conflict.when(modes)) return ctx.fail("usage", conflict.message);
  }
  return undefined;
}

/** The horizon check: a usage failure unless --months is a whole number the forecast allows. */
function forecastMonthsFailure(months: number, ctx: CommandContext): number | undefined {
  if (!Number.isInteger(months) || months < 1 || months > MAX_FORECAST_MONTHS) {
    return ctx.fail("usage", `--months must be a whole number from 1 to ${MAX_FORECAST_MONTHS}.`);
  }
  return undefined;
}

/** Prints the forecast in the selected mode: the SVG, the mermaid block, the timeline, JSON, or text. */
function printForecast(forecast: RepositoryForecast, modes: ForecastModes): void {
  if (modes.svg) {
    process.stdout.write(`${renderForecastSvg(forecast, { animate: modes.animate })}\n`);
    return;
  }
  if (modes.format === "mermaid") {
    process.stdout.write(`${renderForecastMermaid(forecast)}\n`);
    return;
  }
  if (modes.timeline) {
    const width = Math.min(process.stdout.columns || 80, 100);
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    process.stdout.write(`${renderForecastTimeline(forecast, { width, color })}\n`);
    return;
  }
  process.stdout.write(`${modes.json ? JSON.stringify(forecast, null, 2) : renderForecastText(forecast)}\n`);
}

/** Publish a complete file, using an exclusive link unless the caller authorized replacement. */
async function writeCalendar(file: string, calendar: string, force: boolean, ctx: CommandContext): Promise<number> {
  const directory = await mkdtemp(join(dirname(file), ".offing-calendar-"));
  try {
    const temporary = join(directory, "forecast.ics");
    await writeFile(temporary, calendar);
    if (force) await rename(temporary, file);
    else await link(temporary, file);
    return 0;
  } catch (error) {
    if (!force && error instanceof Error && "code" in error && error.code === "EEXIST") {
      return ctx.fail("usage", "Calendar file already exists: " + file + ". Use --force to replace it.");
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const command = {
  name: "forecast",
  flags: [
    "--months",
    "--as-of",
    "--today",
    "--svg",
    "--animate",
    "--timeline",
    "--json",
    "--format",
    "--data-version",
    "--ics",
    "--force",
    ...fleetForecastFlags,
  ],
  example: "offing forecast . --months 6",
  usage: [
    "  offing forecast [path] [--months <n>] [--as-of <YYYY-MM-DD>] [--svg [--animate] | --timeline | --json | --format mermaid]   # what reaches end of life next, by horizon",
    "  offing forecast [path] [--months <n>] [--as-of <YYYY-MM-DD>] --ics [file] [--force]   # export the forecast as a calendar",
    "  offing forecast --fleet <organization|group|fleet.json> [--as-of <YYYY-MM-DD>] [--by owner|repository | --json | --card [--theme light|dark] | --ics <dir> | --digest <dir>]",
  ],
  usageSlots: [13, 14],
  run(args, ctx, readOnly = false) {
    const scanOptions = (state: Gated) => ({ noCache: readOnly || state.noCache });
    if (args.some((arg) => fleetForecastFlags.includes(arg.split("=")[0] ?? arg))) return runFleetForecast(args, ctx);
    return afterGates("forecast", args, ctx, async (state: Gated) => {
      const early = await repositoryPhase(state, ctx);
      if (early !== undefined) return early;
      const pre = preScanPhase(state, ctx);
      if (pre !== undefined) return pre;
      const modes: ForecastModes = {
        ics: state.args.includes("--ics"),
        svg: state.args.includes("--svg"),
        animate: state.args.includes("--animate"),
        timeline: state.args.includes("--timeline"),
        json: state.json,
        format: state.format,
      };
      const modeFailure = forecastModeFailure(modes, ctx);
      if (modeFailure !== undefined) return modeFailure;
      const file = optionalFileOperand(state.optionValue("--ics"));
      const force = state.args.includes("--force");
      if (force && file === undefined) return ctx.fail("usage", "--force needs --ics <file>.");
      const monthsValue = state.optionValue("--months");
      const months = state.args.includes("--months") ? Number(monthsValue) : DEFAULT_FORECAST_MONTHS;
      const monthsFailure = forecastMonthsFailure(months, ctx);
      if (monthsFailure !== undefined) return monthsFailure;
      const asOfValue = state.optionValue("--as-of") ?? state.optionValue("--today");
      if (asOfValue === undefined && (state.args.includes("--as-of") || state.args.includes("--today"))) {
        return ctx.fail("usage", "--as-of (or --today) must be a date (YYYY-MM-DD).");
      }
      const scan = await scanWithBuiltIns(
        state.pathArgument,
        asOfValue === undefined ? scanOptions(state) : replayScanOptions(asOfValue),
      );
      const forecast = await buildRepositoryForecast(scan, months);
      if (modes.ics) {
        const calendar = renderForecastIcs(forecast, scan.findings);
        if (file !== undefined) return writeCalendar(file, calendar, force, ctx);
        process.stdout.write(calendar);
      } else {
        printForecast(forecast, modes);
      }
      return 0;
    });
  },
} satisfies CliCommand;
