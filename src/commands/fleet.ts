import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";

import { severityValues } from "../domain.js";
import { scanFleet, type FleetOptions } from "../fleet/index.js";
import { FleetHostError } from "../fleet/host.js";
import { githubFleetHost, githubFleetToken, gitlabFleetHost, validRepositoryPath } from "../fleet/remote.js";
import { renderRollupHtml, renderRollupText } from "../rollup.js";
import type { CliCommand, CommandContext } from "./types.js";

const options = {
  include: { type: "string", multiple: true },
  exclude: { type: "string", multiple: true },
  topic: { type: "string", multiple: true },
  repos: { type: "string" },
  jobs: { type: "string" },
  policy: { type: "string" },
  gitlab: { type: "boolean" },
  "gitlab-url": { type: "string" },
  "include-forks": { type: "boolean" },
  "include-archived": { type: "boolean" },
  json: { type: "boolean" },
  "image-lineage": { type: "boolean" },
  html: { type: "boolean" },
  format: { type: "string" },
  "no-cache": { type: "boolean" },
  "fail-on": { type: "string" },
  progress: { type: "boolean" },
} as const;

async function repositoryList(file: string): Promise<string[]> {
  const source = await readFile(file, "utf8").catch(() => {
    throw new FleetHostError("Could not read --repos file.");
  });
  const list = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!list.every(validRepositoryPath))
    throw new FleetHostError("The --repos file must contain one repository name per line.");
  return list;
}

const parseFleetArgs = (args: string[]) => parseArgs({ args, options, allowPositionals: true });
type Flags = ReturnType<typeof parseFleetArgs>["values"];

function renderFormat(values: Flags): string {
  const selectors = [values.json, values.html, values.format !== undefined];
  const format = values.format ?? (values.json ? "json" : values.html ? "html" : "text");
  if (selectors.filter(Boolean).length > 1 || !["text", "json", "html"].includes(format)) {
    throw new FleetHostError("Choose one fleet format: text, json, or html.");
  }
  if (values["image-lineage"] && format !== "json") throw new FleetHostError("--image-lineage requires JSON output.");
  return format;
}

async function scanOptions(values: Flags): Promise<FleetOptions> {
  return {
    jobs: Number(values.jobs ?? "4"),
    imageLineage: values["image-lineage"] ?? false,
    noCache: values["no-cache"] ?? false,
    include: values.include ?? [],
    exclude: values.exclude ?? [],
    topics: values.topic ?? [],
    includeForks: values["include-forks"] ?? false,
    includeArchived: values["include-archived"] ?? false,
    ...(values.policy ? { policy: values.policy } : {}),
    ...(values.repos === undefined ? {} : { repositories: await repositoryList(values.repos) }),
    ...(values.progress ? { onProgress: ({ name, status }) => process.stderr.write(`${name}: ${status}\n`) } : {}),
  };
}

function severityIndex(threshold: string): number {
  const index = severityValues.findIndex((value) => value === threshold);
  if (index < 0 && threshold !== "none") throw new FleetHostError("Unknown fleet severity threshold.");
  return index;
}

async function run(args: string[], ctx: CommandContext): Promise<number> {
  try {
    const { values, positionals } = parseFleetArgs(args);
    const [namespace] = positionals;
    if (positionals.length !== 1 || !namespace || !validRepositoryPath(namespace)) {
      return ctx.fail("usage", "Usage: offing fleet <organization|group> [--gitlab] [--json | --html]");
    }
    const format = renderFormat(values);
    const index = severityIndex(values["fail-on"] ?? "none");
    const host =
      values.gitlab || values["gitlab-url"]
        ? gitlabFleetHost(values["gitlab-url"] ?? "https://gitlab.com", process.env.GITLAB_TOKEN?.trim() || undefined)
        : githubFleetHost(await githubFleetToken());
    const result = await scanFleet(host, namespace, await scanOptions(values));
    const output =
      format === "json"
        ? JSON.stringify(result, null, 2)
        : format === "html"
          ? renderRollupHtml(result)
          : renderRollupText(result);
    process.stdout.write(`${output}\n`);
    const policyFailed = result.repositoryStatus.some(
      ({ compliance }) => compliance && compliance.status !== "compliant",
    );
    const gateFailed = index >= 0 && severityValues.slice(index).some((severity) => result.severities[severity] > 0);
    return policyFailed || gateFailed ? 1 : 0;
  } catch (error) {
    return fleetError(error, ctx);
  }
}

function fleetError(error: unknown, ctx: CommandContext): number {
  if (error instanceof FleetHostError) return ctx.fail("usage", error.message);
  if (
    error instanceof TypeError &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("ERR_PARSE_ARGS")
  ) {
    return ctx.fail("usage", "Unknown fleet option or missing option value.");
  }
  throw error;
}

export const command: CliCommand = {
  name: "fleet",
  flags: Object.keys(options).map((key) => `--${key}`),
  example: "offing fleet my-organization --json --jobs 4",
  usage: [
    "  offing fleet <organization|group> --policy <file|reference> [--json | --html]",
    "  offing fleet <organization|group> [--gitlab] [--gitlab-url <url>] [--json | --html]   # scan pinned repository inputs",
    "  offing fleet <organization|group> [--include <glob>] [--exclude <glob>] [--topic <topic>] [--repos <file>] [--image-lineage --json]",
  ],
  run,
};
