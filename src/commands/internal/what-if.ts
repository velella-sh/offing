import process from "node:process";
import { parseArgs } from "node:util";
import { readForecastJson, FleetForecastInputError } from "../../fleet-forecast/input.js";
import { OffingError } from "../../offing-error.js";
import { simulateFleet } from "../../what-if/fleet.js";
import { simulateRepository } from "../../what-if/index.js";
import { renderWhatIf, type WhatIfFormat } from "../../what-if/render.js";
import { simulationTargets } from "../../what-if/target.js";
import type { CommandContext } from "../types.js";

const options = {
  target: { type: "string", multiple: true },
  effort: { type: "boolean" },
  fleet: { type: "string" },
  json: { type: "boolean" },
  format: { type: "string" },
  "as-of": { type: "string" },
  today: { type: "string" },
  months: { type: "string" },
} as const;

const parse = (args: string[]) => parseArgs({ args, options, allowPositionals: true });
type Flags = ReturnType<typeof parse>["values"];

function formatOf(values: Flags): WhatIfFormat {
  const format = values.format ?? (values.json ? "json" : "text");
  if ((format === "text" || format === "json" || format === "markdown") && (!values.json || format === "json"))
    return format;
  throw new OffingError("invalid-argument", "Choose --json or --format text|json|markdown.");
}

function simulationDate(values: Flags): string | undefined {
  if (values["as-of"] !== undefined && values.today !== undefined) {
    throw new OffingError("invalid-argument", "Use either --as-of or --today.");
  }
  return values["as-of"] ?? values.today;
}

async function loadReport(values: Flags, positionals: string[]) {
  const targets = simulationTargets(values.target ?? []);
  const asOf = simulationDate(values);
  if (positionals.length > 1) throw new OffingError("invalid-argument", "Provide one repository path.");
  if (values.fleet === undefined) {
    return simulateRepository(positionals[0] ?? ".", targets, {
      ...(asOf === undefined ? {} : { asOf }),
      ...(values.months === undefined ? {} : { months: Number(values.months) }),
      effort: values.effort ?? false,
    });
  }
  if (positionals.length > 0 || values.months !== undefined || values.effort) {
    throw new OffingError(
      "invalid-argument",
      "Saved fleet simulations accept --fleet <fleet.json> and targets, without a local path, --months or --effort.",
    );
  }
  return simulateFleet(await readForecastJson(values.fleet), targets, asOf);
}

export async function runWhatIf(args: string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parse(args);
  } catch {
    return ctx.fail("usage", "Unknown what-if option or missing option value.");
  }
  try {
    const { values, positionals } = parsed;
    const format = formatOf(values);
    const report = await loadReport(values, positionals);
    process.stdout.write(`${renderWhatIf(report, format)}\n`);
    return 0;
  } catch (error) {
    if (
      error instanceof FleetForecastInputError ||
      (error instanceof OffingError && error.code === "invalid-argument")
    ) {
      return ctx.fail("usage", error.message);
    }
    throw error;
  }
}
