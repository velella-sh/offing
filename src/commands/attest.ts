import process from "node:process";
import { parseArgs } from "node:util";

import { withPrepared } from "./runtime.js";
import type { CliCommand, CommandContext } from "./types.js";

const usage = "offing attest [path] --subject <file|sha256:...> [--sbom <file>] [--data-version <version>]";
const checkUsage = "offing attest check <statement|bundle> [--subject <file|sha256:...>] [--today <date>]";

export const command: CliCommand = {
  name: "attest",
  flags: ["--subject", "--sbom", "--data-version", "--today"],
  example: "offing attest --subject package.tgz --sbom sbom.cdx.json > lifecycle.intoto.json",
  usage: [`  ${usage}`, `  ${checkUsage}`],
  completion: { subcommands: ["check"] },
  async run(args, ctx) {
    return args[0] === "check" ? check(args.slice(1), ctx) : create(args, ctx);
  },
};

const subjectOption = { subject: { type: "string" } } as const;

async function create(args: string[], ctx: CommandContext): Promise<number> {
  const options = { ...subjectOption, sbom: { type: "string" }, "data-version": { type: "string" } } as const;
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true });
  } catch {
    return ctx.fail("usage", `Usage: ${usage}`);
  }
  const { positionals, values } = parsed;
  const path = positionals[0] ?? ".";
  const subject = values.subject;
  if (positionals.length > 1 || !subject || values.sbom === "" || values["data-version"] === "") {
    return ctx.fail("usage", `Usage: ${usage}`);
  }
  const preparedArgs = [path, ...(values["data-version"] ? ["--data-version", values["data-version"]] : [])];
  return withPrepared("attest", preparedArgs, ctx, async () => {
    const { buildStatement } = await import("../attestation/build.js");
    const { validateStatement } = await import("../attestation/check.js");
    const statement = await validateStatement(await buildStatement(path, subject, values.sbom));
    process.stdout.write(`${JSON.stringify(statement, null, 2)}\n`);
    return 0;
  });
}

async function check(args: string[], ctx: CommandContext): Promise<number> {
  const options = { ...subjectOption, today: { type: "string" } } as const;
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true });
  } catch {
    return ctx.fail("usage", `Usage: ${checkUsage}`);
  }
  const { positionals, values } = parsed;
  const file = positionals[0];
  if (!file || positionals.length !== 1 || values.subject === "") return ctx.fail("usage", `Usage: ${checkUsage}`);
  const asOf = values.today ?? new Date().toISOString().slice(0, 10);
  const { checkAttestation } = await import("../attestation/check.js");
  const result = await checkAttestation(file, asOf, values.subject);
  const rows = result.components.map(({ purl, name, version, status, rules, location }) => {
    const dates = rules.map(({ ruleId, daysLeft }) =>
      daysLeft === undefined ? ruleId : `${ruleId}: ${daysLeft} days left`,
    );
    const identity = purl ?? name;
    return `- ${JSON.stringify(version ? `${identity}@${version}` : identity)}${location ? ` (${JSON.stringify(location)})` : ""}: ${status}${dates.length ? `, ${dates.join(", ")}` : ""}`;
  });
  const report = [
    `Lifecycle status as of ${result.asOf} UTC (${result.components.length} observations, built ${result.statement.predicate.builtOn})`,
    ...rows,
    "Cryptographic verification requires an external verifier.",
  ];
  process.stdout.write(`${report.join("\n")}\n`);
  return 0;
}
