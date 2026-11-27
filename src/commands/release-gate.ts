import process from "node:process";
import { configureActiveData } from "@velella/ebb/data-source";
import { parseArgs } from "node:util";

import type { CliCommand, CommandContext } from "./types.js";
import type { AttestationTrust } from "../release-gate/attestation.js";
import type { GateDecision, GateWindow } from "../release-gate/decision.js";

const usage =
  "offing release-gate <ref|path> | --sbom <file|-> | --attestation <bundle> [--within-days <days> | --support-until <date>] [--today <date>] [--no-data fail|warn|ignore] [--json | --format text|json|sarif]";
const attestationUsage =
  "--attestation also requires --subject <artifact> --repo <owner/repo> --signer-workflow <workflow> --trusted-root <file>";
const stringOption = { type: "string" } as const;
const options = {
  sbom: stringOption,
  attestation: stringOption,
  subject: stringOption,
  repo: stringOption,
  "signer-workflow": stringOption,
  "trusted-root": stringOption,
  "within-days": stringOption,
  "support-until": stringOption,
  today: stringOption,
  "no-data": stringOption,
  json: { type: "boolean", default: false },
  format: stringOption,
} as const;

interface Parsed {
  target: string;
  kind: "repository" | "sbom" | "attestation";
  trust?: AttestationTrust;
  window: GateWindow;
  format: "text" | "json" | "sarif";
}

function attestationTrust(values: ReturnType<typeof readReleaseArgs>["values"]): AttestationTrust | undefined {
  const { subject, repo, "signer-workflow": signerWorkflow, "trusted-root": trustedRoot } = values;
  if (!subject || !repo || !signerWorkflow || !trustedRoot) return undefined;
  return { subject, repository: repo, signerWorkflow, trustedRoot };
}

function readReleaseArgs(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options });
}

function releaseInputArgs(
  values: ReturnType<typeof readReleaseArgs>["values"],
  positionals: readonly string[],
): Pick<Parsed, "target" | "kind" | "trust"> | string {
  const { sbom, attestation } = values;
  const selected = [...positionals, ...[sbom, attestation].filter((value) => value !== undefined)];
  const [target] = selected;
  if (selected.length !== 1 || !target) return "Provide exactly one directory, Git ref, SBOM or attestation.";
  const trust = attestationTrust(values);
  const hasTrust = [values.subject, values.repo, values["signer-workflow"], values["trusted-root"]].some(
    (value) => value !== undefined,
  );
  if (attestation && !trust) return attestationUsage;
  if (!attestation && hasTrust) return "Signer and artifact options require --attestation.";
  return { target, kind: sbom ? "sbom" : attestation ? "attestation" : "repository", ...(trust ? { trust } : {}) };
}

function releaseFormat(values: ReturnType<typeof readReleaseArgs>["values"]): Parsed["format"] | { error: string } {
  const format = values.format ?? (values.json ? "json" : "text");
  if (format !== "json" && format !== "text" && format !== "sarif")
    return { error: "Expected --format text, json or sarif." };
  if (values.json && format !== "json") return { error: "--json requires JSON output." };
  return format;
}

async function parseReleaseArgs(args: string[]): Promise<Parsed | string> {
  let parsed;
  try {
    parsed = readReleaseArgs(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const { values, positionals } = parsed;
  const input = releaseInputArgs(values, positionals);
  if (typeof input === "string") return input;
  const days = values["within-days"];
  if (days !== undefined && values["support-until"] !== undefined)
    return "Choose one of --within-days and --support-until.";
  const format = releaseFormat(values);
  if (typeof format !== "string") return format.error;
  const { gateWindow, parseGateDays } = await import("../release-gate/decision.js");
  const window = gateWindow(
    values.today ?? new Date().toISOString().slice(0, 10),
    days === undefined ? undefined : parseGateDays(days),
    values["support-until"],
    values["no-data"],
  );
  return { ...input, window, format };
}

async function evaluate(parsed: Parsed): Promise<GateDecision> {
  const { target, kind, trust, window } = parsed;
  const root = process.cwd();
  const pinnedVersion = process.env.OFFING_DATA_VERSION;
  configureActiveData(pinnedVersion ? { pinnedVersion } : {});
  const { evaluateRepository, localExceptions, releaseInput, sbomObservations } = await import(
    "../release-gate/inputs.js"
  );
  if (kind === "repository") return evaluateRepository(await releaseInput(target), window, root);
  const { decideRelease } = await import("../release-gate/decision.js");
  const exceptions = await localExceptions(root, window);
  if (trust) {
    const { attestationObservations } = await import("../release-gate/attestation.js");
    return decideRelease(
      { kind, target },
      await attestationObservations(target, trust, window.asOf),
      window,
      exceptions,
    );
  }
  return decideRelease({ kind, target }, await sbomObservations(target, root), window, exceptions);
}

async function run(args: string[], ctx: CommandContext): Promise<number> {
  const parsed = await parseReleaseArgs(args);
  if (typeof parsed === "string") return ctx.fail("usage", parsed);
  const { gateReport } = await import("../release-gate/decision.js");
  const { renderGate } = await import("../release-gate/render.js");
  const decision = await evaluate(parsed);
  const report = gateReport(parsed.window, [decision]);
  process.stdout.write(`${renderGate(report, parsed.format)}\n`);
  return decision.verdict === "block" ? ctx.exitCodes.policy : 0;
}

export const command: CliCommand = {
  name: "release-gate",
  flags: Object.keys(options).map((name) => `--${name}`),
  example: "offing release-gate . --within-days 30",
  usage: [`  ${usage}`, `    ${attestationUsage}`],
  run,
};
