import process from "node:process";

import { configureActiveData } from "@velella/ebb/data-source";

import { meetsGuardThreshold, type AgentGuardGate } from "../agent-guard.js";
import { builtInDetectors } from "../detectors/index.js";
import type { Detector } from "../sdk.js";
import { severityValues, type Finding, type ScanResult, type Severity } from "../domain.js";
import { classifyError } from "../offing-error.js";
import { scanRepositoryFindings } from "../engine/index.js";
import { failOpen, findingsForEdit } from "./index.js";
import { builtInHostHooks } from "./registry.js";
import type { HookResponse, HostAdapter } from "./types.js";

/** The whole hook budget. A slow scan fails open rather than holding the agent's turn. */
export const HOOK_TIMEOUT_MS = 10_000;

/** The default gate: findings below `medium` are noise for a file the agent is still editing. */
export const DEFAULT_HOOK_GATE: Severity = "medium";

export type HookGate = AgentGuardGate;

export interface HookOptions {
  /** Host adapters to translate with; the built-in list by default. */
  readonly adapters?: readonly HostAdapter[];
  /** Runs the scan; `scanRepositoryFindings` with the built-in detectors by default. */
  readonly scan?: (root: string, detectors: readonly Detector[]) => Promise<Pick<ScanResult, "findings">>;
  /** Overall budget in milliseconds; `HOOK_TIMEOUT_MS` by default. */
  readonly timeoutMs?: number;
  /** Environment handed to `parse`; `process.env` by default. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface HookArguments {
  readonly host: string;
  readonly gate: HookGate;
}

/** Reads `<host> [--fail-on <severity|none>]`; undefined for anything a hook should treat as fail-open. */
export function parseHookArguments(argv: readonly string[]): HookArguments | undefined {
  let host: string | undefined;
  let gate: HookGate = DEFAULT_HOOK_GATE;
  const pending = [...argv];
  for (let argument = pending.shift(); argument !== undefined; argument = pending.shift()) {
    if (argument === "--fail-on") {
      const value = pending.shift();
      if (value === undefined) return undefined;
      if (value !== "none" && !severityValues.includes(value as Severity)) return undefined;
      gate = value as HookGate;
      continue;
    }
    if (argument.startsWith("-") || host !== undefined) return undefined;
    host = argument;
  }
  return host === undefined ? undefined : { host, gate };
}

/** Keeps findings at or above the gate, in a stable order, for the files the payload named. */
export function findingsAtGate(
  findings: readonly Finding[],
  gate: HookGate,
  edit: Parameters<typeof findingsForEdit>[1],
): Finding[] {
  if (gate === "none") return [];
  return findingsForEdit(findings, edit).filter((finding) => meetsGuardThreshold(finding.severity, gate));
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<undefined>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(undefined), timeoutMs);
  });
  return Promise.race([operation, budget]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isPreWrite(host: string, payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || !("hook_event_name" in payload)) return false;
  const event = payload.hook_event_name;
  if (host === "cursor") return event === "preToolUse";
  return (host === "claude-code" || host === "codex") && event === "PreToolUse";
}

function missingDataResponse(host: string): HookResponse {
  const warning = "Offing warning: lifecycle data is unavailable; this edit was not checked.";
  if (host === "claude-code" || host === "codex") {
    const output = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: warning } };
    return { ...failOpen, stdout: `${JSON.stringify(output)}\n` };
  }
  return { ...failOpen, stderr: `${warning}\n` };
}

/**
 * Turns one host payload into the response the host understands. Every failure — an unknown host, a malformed
 * payload, an event that is not an edit, a scan error, or a timeout — lets the agent continue.
 * Missing lifecycle data also returns one host-facing warning.
 */
export async function hookResponse(
  argv: readonly string[],
  stdin: string,
  options: HookOptions = {},
): Promise<HookResponse> {
  const args = parseHookArguments(argv);
  if (args === undefined) return failOpen;

  try {
    const adapters = options.adapters ?? (await builtInHostHooks()).map((hook) => hook.adapter);
    const adapter = adapters.find((candidate) => candidate.id === args.host);
    if (adapter === undefined) return failOpen;
    const payload: unknown = JSON.parse(stdin);
    const env = options.env ?? process.env;
    const timeout = options.timeoutMs ?? HOOK_TIMEOUT_MS;
    if (args.gate === "none") return failOpen;
    if (isPreWrite(args.host, payload)) {
      const { preWriteResponse } = await import("./pre-write.js");
      const check = preWriteResponse(args.host, payload, env, args.gate);
      return (await withTimeout(check, timeout)) ?? failOpen;
    }
    const edit = adapter.parse(payload, env);
    if (!edit) return failOpen;
    const scan = options.scan ?? scanRepositoryFindings;
    const scanned = await withTimeout(scan(edit.root, builtInDetectors), timeout);
    if (scanned === undefined) return failOpen;
    return adapter.respond(findingsAtGate(scanned.findings, args.gate, edit));
  } catch (error) {
    const { code } = classifyError(error);
    return code === "data-unavailable" || code === "package-file-not-found" ? missingDataResponse(args.host) : failOpen;
  }
}

/** Reads the host payload from stdin; a host always closes it after one JSON document. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

/** Runs `offing hook <host>`: reads the host payload from stdin and writes the response. */
export async function runHook(
  argv: readonly string[],
  options: HookOptions & { readonly stdin?: () => Promise<string> } = {},
): Promise<number> {
  const pin = (options.env ?? process.env).OFFING_DATA_VERSION;
  if (pin) configureActiveData({ pinnedVersion: pin });
  const read = options.stdin ?? readStdin;
  if (argv[0] === "session-start") {
    const { runSessionStart } = await import("./session-start.js");
    return runSessionStart(argv.slice(1), read);
  }
  const response = await hookResponse(argv, await read().catch(() => ""), options);
  if (response.stdout !== "") process.stdout.write(response.stdout);
  if (response.stderr !== "") process.stderr.write(response.stderr);
  return response.exitCode;
}
