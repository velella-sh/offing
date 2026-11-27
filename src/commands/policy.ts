import { isIsoDate } from "@velella/ebb/registry";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadConfig } from "../config.js";
import { loadFleetPolicy } from "../fleet-policy/load.js";
import { ruleKeys, type EffectivePolicy } from "../fleet-policy/merge.js";
import { fetchRemotePolicy } from "../fleet-policy/remote.js";
import type { CliCommand } from "./types.js";

const usage =
  "Usage: offing policy <validate|pull> [repository] [--policy <ref>] [--today <date>]\n       offing policy explain <rule> [repository] [--policy <ref>] [--today <date>]";

function parseOptions(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { policy: { type: "string" }, today: { type: "string" } },
  });
}

function parseOperands(positionals: readonly string[]) {
  const [verb, first, second] = positionals;
  if (verb === "explain" && first && positionals.length <= 3) return { verb, repository: second, rule: first };
  if ((verb === "validate" || verb === "pull") && positionals.length <= 2) return { verb, repository: first };
  return undefined;
}

function renderPolicy(effective: EffectivePolicy, rule: string | undefined): string | undefined {
  if (!rule)
    return `Valid fleet policy with ${effective.rules.length} rule(s) and ${effective.exceptions.length} exception(s).`;
  const selection = effective.rules.find((entry) => entry.rule.id === rule);
  if (!selection) return undefined;
  const values = ruleKeys.flatMap((key) => {
    const origin = selection.origins[key];
    return origin
      ? [`${key} = ${JSON.stringify(selection.rule[key])} (${origin.layer}, ${origin.file}:${origin.line})`]
      : [];
  });
  return [rule, ...values].join("\n");
}

export const command: CliCommand = {
  name: "policy",
  flags: ["--policy", "--today"],
  example: "offing policy validate",
  usage: [
    "  offing policy validate [repository] [--policy <ref>] [--today <date>]",
    "  offing policy explain <rule> [repository] [--policy <ref>]",
    "  offing policy pull [repository] [--policy <ref>]",
  ],
  completion: { subcommands: ["validate", "explain", "pull"] },
  async run(args, ctx) {
    let parsed: ReturnType<typeof parseOptions>;
    try {
      parsed = parseOptions(args);
    } catch {
      return ctx.fail("usage", usage);
    }
    const operands = parseOperands(parsed.positionals);
    if (!operands) return ctx.fail("usage", usage);
    const { verb, repository, rule } = operands;
    const root = resolve(repository ?? ".");
    const today = parsed.values.today ?? new Date().toISOString().slice(0, 10);
    if (!isIsoDate(today)) return ctx.fail("usage", "--today expects a date (YYYY-MM-DD).");
    const config = await loadConfig(root);
    const effective = await loadFleetPolicy({
      root,
      today,
      config,
      reference: parsed.values.policy,
      ...(verb === "pull" ? { fetchPolicy: fetchRemotePolicy } : {}),
    });
    if (!effective) return ctx.fail("usage", "No fleet policy selected. Set extends in .offing.json or use --policy.");
    const output = renderPolicy(effective, rule);
    if (!output) return ctx.fail("usage", `Fleet policy does not define rule ${rule}.`);
    process.stdout.write(`${output}\n`);
    return 0;
  },
};
