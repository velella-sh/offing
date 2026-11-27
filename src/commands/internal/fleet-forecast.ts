import { mkdir, open, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { isIsoDate } from "@velella/ebb/registry";
import { applyFallbackOwners } from "../../fleet-forecast/capture.js";
import {
  FleetForecastInputError,
  parseForecastRecording,
  readForecastJson,
  readPreviousForecast,
} from "../../fleet-forecast/input.js";
import { buildFleetForecast, compareFleetForecast, type FleetForecast } from "../../fleet-forecast/model.js";
import {
  renderFleetCalendars,
  renderFleetDigests,
  renderFleetForecastCard,
  renderFleetForecastText,
} from "../../fleet-forecast/render.js";
import { FleetHostError } from "../../fleet/host.js";
import { scanFleet } from "../../fleet/index.js";
import { fleetHostFor, validRepositoryPath } from "../../fleet/remote.js";
import { readRollupOwners, RollupError } from "../../rollup.js";
import type { CommandContext } from "../types.js";

const fleetOptions = {
  fleet: { type: "string" },
  by: { type: "string" },
  card: { type: "boolean" },
  theme: { type: "string" },
  digest: { type: "string" },
  previous: { type: "string" },
  owners: { type: "string" },
  gitlab: { type: "boolean" },
  "gitlab-url": { type: "string" },
} as const;

export const fleetForecastFlags = Object.keys(fleetOptions).map((name) => `--${name}`);

const parse = (args: string[]) =>
  parseArgs({
    args,
    options: {
      ...fleetOptions,
      "as-of": { type: "string" },
      today: { type: "string" },
      ics: { type: "string" },
      json: { type: "boolean" },
    },
  });
type Flags = ReturnType<typeof parse>["values"];

function parseFlags(args: string[]): Flags {
  try {
    return parse(args).values;
  } catch {
    throw new FleetForecastInputError("Unknown fleet forecast option or missing option value.");
  }
}

function validateModes(values: Flags): void {
  const choices = [values.card, values.ics !== undefined, values.digest !== undefined, values.json];
  if (choices.filter(Boolean).length > 1) {
    throw new FleetForecastInputError("Choose one of --card, --ics, --digest, or --json.");
  }
  if (values.by !== undefined && (choices.some(Boolean) || !["owner", "repository"].includes(values.by))) {
    throw new FleetForecastInputError("--by accepts owner or repository in the text output.");
  }
  if (values.theme !== undefined && (!values.card || !["light", "dark"].includes(values.theme))) {
    throw new FleetForecastInputError("--theme accepts light or dark with --card.");
  }
  if (values["as-of"] !== undefined && values.today !== undefined) {
    throw new FleetForecastInputError("Use either --as-of or --today.");
  }
}

async function isLocalRecording(source: string): Promise<boolean> {
  if (source.toLowerCase().endsWith(".json")) return true;
  return (await stat(source).catch(() => undefined))?.isFile() ?? false;
}

async function defaultOwnersFile(): Promise<string | undefined> {
  try {
    await stat("owners.json");
    return "owners.json";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new FleetForecastInputError("Cannot read owners.json.");
  }
}

async function loadRecording(source: string, values: Flags, asOf: string | undefined) {
  const gitlab = Boolean(values.gitlab || values["gitlab-url"] !== undefined);
  if (await isLocalRecording(source)) {
    if (gitlab)
      throw new FleetForecastInputError("Apply GitLab options when recording a group, not when reading a file.");
    return parseForecastRecording(await readForecastJson(source));
  }
  if (!validRepositoryPath(source)) {
    throw new FleetForecastInputError("Give a GitHub organization, a GitLab group, or a saved fleet JSON file.");
  }
  const host = await fleetHostFor(values.gitlab, values["gitlab-url"]);
  const snapshot = await scanFleet(host, source, { forecast: { gitlab, ...(asOf === undefined ? {} : { asOf }) } });
  return parseForecastRecording(snapshot);
}

async function writeOwnerFiles(directory: string, files: Map<string, string>): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new FleetForecastInputError("Choose a new, writable output directory whose parent already exists.");
  }
  const created: string[] = [];
  try {
    for (const [name, contents] of files) {
      const path = join(directory, name);
      const file = await open(path, "wx", 0o600);
      created.push(path);
      try {
        await file.writeFile(contents);
      } finally {
        await file.close();
      }
    }
  } catch {
    await Promise.allSettled(created.map((path) => rm(path, { force: true })));
    await rmdir(directory).catch(() => undefined);
    throw new FleetForecastInputError("Could not write the owner artifacts.");
  }
}

async function publishForecast(forecast: FleetForecast, values: Flags): Promise<void> {
  if (values.ics !== undefined) return writeOwnerFiles(values.ics, renderFleetCalendars(forecast));
  if (values.digest !== undefined) return writeOwnerFiles(values.digest, renderFleetDigests(forecast));
  const content = values.card
    ? renderFleetForecastCard(forecast, values.theme === "dark" ? "dark" : "light")
    : values.json
      ? JSON.stringify(forecast, null, 2)
      : renderFleetForecastText(forecast, values.by === "repository" ? "repository" : "owner");
  process.stdout.write(`${content}\n`);
}

export async function runFleetForecast(args: string[], ctx: CommandContext): Promise<number> {
  try {
    const values = parseFlags(args);
    if (!values.fleet) return ctx.fail("usage", "--fleet needs an organization, group, or fleet JSON file.");
    validateModes(values);
    const asOf = values["as-of"] ?? values.today;
    if (asOf !== undefined && !isIsoDate(asOf)) return ctx.fail("usage", "--as-of needs a date (YYYY-MM-DD).");
    const ownersFile = values.owners ?? (await defaultOwnersFile());
    const [recording, owners, previous] = await Promise.all([
      loadRecording(values.fleet, values, asOf),
      readRollupOwners(ownersFile),
      values.previous === undefined ? undefined : readPreviousForecast(values.previous),
    ]);
    const observed = applyFallbackOwners(recording.repositories, owners);
    const forecast = buildFleetForecast(observed, asOf ?? recording.today);
    if (previous && previous.today > forecast.today) {
      return ctx.fail("usage", "The previous forecast cannot be newer than the current day.");
    }
    if (previous) forecast.changes = compareFleetForecast(previous, forecast, observed);
    await publishForecast(forecast, values);
    return 0;
  } catch (error) {
    if (error instanceof FleetForecastInputError || error instanceof FleetHostError || error instanceof RollupError) {
      return ctx.fail("usage", error.message);
    }
    throw error;
  }
}
