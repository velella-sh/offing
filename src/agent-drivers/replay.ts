import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { performance } from "node:perf_hooks";

import { createBudget, type BudgetUsage } from "../autopilot/limits/budget.js";
import type { AutopilotConfig } from "../autopilot/limits/config.js";
import { createPathScope } from "../autopilot/limits/scope.js";
import { childEnvironments } from "../autopilot/limits/secrets.js";
import type { MigrationPacket } from "../migration-packet.js";
import { type AgentDriver, type AgentRunInput, makeResult } from "./contract.js";
import { numberOrNull, readJsonFile, record, validPaths } from "./result.js";

const success = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  signal: null,
  timedOut: false,
};

function edits(value: unknown): Array<[string, string]> {
  const turn = record(value);
  if (!turn) throw new Error("Invalid replay turn.");
  const entries = Object.entries(turn);
  if (!validPaths(entries.map(([path]) => path))) throw new Error("Invalid replay file path.");
  return entries.map(([path, content]) => {
    if (typeof content !== "string") throw new Error("Replay file content must be text.");
    return [path, content];
  });
}

async function inside(root: string, path: string): Promise<boolean> {
  const father = dirname(join(root, path));
  return relative(root, await realpath(father)) === relative(root, father);
}

async function destinationMode(path: string): Promise<number | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("Replay target must be a regular file.");
    return info.mode & 0o777;
  } catch (error) {
    if (record(error)?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function write(path: string, content: string | Uint8Array): Promise<void> {
  const mode = await destinationMode(path);
  const temporary = await mkdtemp(join(dirname(path), ".offing-replay-"));
  const file = join(temporary, "content");
  try {
    await writeFile(file, content, {
      encoding: "utf8",
      ...(mode === undefined ? {} : { mode }),
    });
    await rename(file, path);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const freeTurn = { turns: 1, tokens: 0, costCents: 0 };

const replayWorkerModules = [
  "agent-drivers/replay.js",
  "agent-drivers/contract.js",
  "agent-drivers/result.js",
  "autopilot/limits/budget.js",
  "autopilot/limits/config.js",
  "autopilot/limits/scope.js",
  "autopilot/limits/secrets.js",
] as const;

function recordedUsage(value: unknown, count: number): BudgetUsage[] {
  if (value === undefined) return Array.from({ length: count }, () => freeTurn);
  if (!Array.isArray(value) || value.length !== count) throw new Error("Invalid replay turn usage.");
  return value.map((item: unknown) => {
    const usage = record(item);
    const turns = numberOrNull(usage?.turns);
    const tokens = numberOrNull(usage?.tokens);
    const costCents = numberOrNull(usage?.costCents);
    if (!turns || tokens === null || costCents === null) throw new Error("Invalid replay turn usage.");
    return { turns, tokens, costCents };
  });
}

async function applyGuarded(
  root: string,
  turn: Array<[string, string]>,
  meter: { check: () => string | null; finish: () => string | null },
): Promise<string | null> {
  const originals = new Map<string, Uint8Array | undefined>();
  for (const [path] of turn) {
    const stop = meter.check();
    if (stop) return stop;
    const file = join(root, path);
    const mode = await destinationMode(file);
    originals.set(file, mode === undefined ? undefined : await readFile(file));
  }
  const changed: string[] = [];
  let accepted = false;
  try {
    for (const [path, content] of turn) {
      const stop = meter.check();
      if (stop) return stop;
      const file = join(root, path);
      await write(file, content);
      changed.push(file);
    }
    const stop = meter.finish();
    accepted = stop === null;
    return stop;
  } finally {
    if (!accepted) {
      for (const file of changed.reverse()) {
        const original = originals.get(file);
        if (original === undefined) await rm(file);
        else await write(file, original);
      }
    }
  }
}

class ReplayRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

interface ReplayGuardrails {
  config: AutopilotConfig;
  packets: readonly Pick<MigrationPacket, "affectedFiles">[];
  testFiles: readonly string[];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  started?: number;
  beforeTurn?: (number: number) => Promise<(path: string) => boolean>;
  afterTurn?: (number: number, files: readonly string[]) => Promise<boolean>;
}

function guardrails(options: ReplayGuardrails) {
  return {
    permits: createPathScope(options.config, options.packets, options.testFiles),
    budget: createBudget(options.config.budget, options.now, options.started),
    ...childEnvironments(options.environment ?? process.env, "replay", options.config.secretEnv),
  };
}

async function plan(file: string, input: AgentRunInput, guard?: ReturnType<typeof guardrails>) {
  const snapshot = record(await readJsonFile(file, 8 * 1024 * 1024));
  if (snapshot?.schemaVersion !== "offing.agent-replay.v1" || !Array.isArray(snapshot.turns)) {
    throw new Error("Expected offing.agent-replay.v1 turns.");
  }
  const root = await realpath(input.worktreePath);
  const turns = snapshot.turns.map(edits);
  const usage = recordedUsage(snapshot.turnUsage, turns.length);
  const paths = [...new Set(turns.flatMap((turn) => turn.map(([path]) => path)))].sort();
  const allowed = input.allowedPaths && new Set(input.allowedPaths);
  if (
    guard &&
    turns.some((turn) => turn.some(([path, content]) => guard.containsSecret(path) || guard.containsSecret(content)))
  ) {
    throw new ReplayRefusal("secret-turn-diff", "Autopilot refused a secret in a replay turn.");
  }
  for (const path of paths) {
    const inScope = guard ? guard.permits(path) && (allowed?.has(path) ?? true) : allowed?.has(path);
    if (!inScope || !(await inside(root, path)))
      throw new ReplayRefusal("outside-path-scope", `Replay attempted a write outside its scope: ${path}`);
    await destinationMode(join(root, path));
  }
  return { root, turns: turns.map((turn, index) => ({ turn, usage: usage[index] ?? freeTurn })) };
}

function rejectBudget(stop: string): never {
  throw new ReplayRefusal(stop, "Autopilot budget stopped the run at " + stop + ".");
}

async function applyReplayTurn(
  root: string,
  turn: Array<[string, string]>,
  usage: BudgetUsage,
  guard: ReturnType<typeof guardrails> | undefined,
  confirm?: (wallTimeMs: number) => Promise<void>,
): Promise<void> {
  if (!guard) {
    for (const [path, content] of turn) await write(join(root, path), content);
    return;
  }
  const permit = guard.budget.begin();
  if ("stop" in permit) rejectBudget(permit.stop);
  const check = permit.check(usage);
  if (check) rejectBudget(check);
  await confirm?.(permit.limits.wallTimeMs);
  const stop = await applyGuarded(root, turn, {
    check: () => permit.check(usage),
    finish: () => permit.finish(usage),
  });
  if (stop) rejectBudget(stop);
}

type PlannedTurn = Awaited<ReturnType<typeof plan>>["turns"][number];
type ReplayReceipt = { completed: number; stopped: string | null };
type ConnectDocker = typeof import("../test-runners/docker.js").connectDocker;

async function stageWorker(staging: string, turns: readonly PlannedTurn[], config: AutopilotConfig, remaining: number) {
  const paths = new Set(turns.flatMap(({ turn }) => turn.map(([path]) => path)));
  await mkdir(join(staging, "checkout"));
  for (const path of paths) await mkdir(dirname(join(staging, "checkout", path)), { recursive: true });
  for (const module of replayWorkerModules) {
    const target = join(staging, module);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL("../" + module, import.meta.url), target);
  }
  await writeFile(join(staging, "package.json"), '{"type":"module"}');
  await writeFile(
    join(staging, "recording.json"),
    JSON.stringify({
      schemaVersion: "offing.agent-replay.v1",
      turns: turns.map(({ turn }) => Object.fromEntries(turn)),
      turnUsage: turns.map(({ usage }) => usage),
    }),
  );
  await writeFile(
    join(staging, "config.json"),
    JSON.stringify({
      allowedPaths: [...paths],
      deniedPaths: [],
      driver: "replay",
      tests: [],
      secretEnv: [],
      budget: { ...config.budget, run: { ...config.budget.run, wallTimeMs: remaining } },
    }),
  );
}

function readReceipt(bytes: Buffer, turns: readonly PlannedTurn[]): ReplayReceipt {
  const raw = record(JSON.parse(bytes.toString("utf8")));
  const completed = numberOrNull(raw?.completed);
  const stopped = raw?.stopped;
  if (completed === null || completed > turns.length || (stopped === null && completed !== turns.length)) {
    throw new Error("Invalid replay container receipt.");
  }
  if (
    stopped !== null &&
    (typeof stopped !== "string" || !/^(?:run|turn)\.(?:wallTimeMs|turns|tokens|costCents)$/u.test(stopped))
  ) {
    throw new Error("Invalid replay container stop reason.");
  }
  const files = new Map<string, string>();
  for (const { turn } of turns.slice(0, completed)) {
    for (const [path, text] of turn) files.set(path, createHash("sha256").update(text).digest("hex"));
  }
  const expected = [...files].sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1));
  if (JSON.stringify(raw?.files) !== JSON.stringify(expected))
    throw new Error("Replay container file hashes do not match.");
  return { completed, stopped };
}

async function replayInContainer(
  turns: readonly PlannedTurn[],
  options: ReplayGuardrails,
  connect?: ConnectDocker,
  turnWallTimeMs?: number,
): Promise<ReplayReceipt> {
  const runner = await import("../test-runners/docker.js");
  const now = performance.now();
  const runDeadline = (options.started ?? now) + options.config.budget.run.wallTimeMs;
  const turnDeadline = now + (turnWallTimeMs ?? Infinity);
  const deadline = Math.min(runDeadline, turnDeadline);
  const reason = deadline === runDeadline ? "run.wallTimeMs" : "turn.wallTimeMs";
  const remaining = () => Math.floor(deadline - performance.now());
  const folder = await mkdtemp(join(tmpdir(), "offing-replay-container-"));
  try {
    const staging = join(folder, "source");
    await mkdir(staging);
    const docker = await (connect ?? runner.connectDocker)(folder);
    const budget = remaining();
    if (budget < 1) rejectBudget(reason);
    const signal = AbortSignal.timeout(Math.min(budget, 120_000));
    const image = await runner.prepareImage((args) => docker(args, signal), "npm", "");
    const initial = remaining();
    if (initial < 1) rejectBudget(reason);
    await stageWorker(staging, turns, options.config, initial);
    const source = await runner.archiveTree(staging);
    if (remaining() < 1) rejectBudget(reason);
    const output: Uint8Array[] = [];
    const result = await runner.sandbox(docker, image, source)(
      ["node", "--input-type=module", "--eval", replayWorker],
      {
        signal,
        stdout: (chunk) => output.push(chunk),
        stderr: () => {},
      },
      false,
    );
    if (result.exitCode !== 0) throw new Error("The trusted replay worker failed.");
    return readReceipt(Buffer.concat(output), turns);
  } catch (error) {
    if (error instanceof ReplayRefusal) throw error;
    if (remaining() < 1) rejectBudget(reason);
    throw new ReplayRefusal("container-runtime-unavailable", "The pinned replay container is unavailable.");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function acceptedTurns(turns: PlannedTurn[], options?: ReplayGuardrails, connect?: ConnectDocker) {
  if (!options) return { turns, stopped: null };
  const first = turns[0];
  if (first) {
    const permit = createBudget(options.config.budget, options.now, options.started).begin();
    if ("stop" in permit) rejectBudget(permit.stop);
    const stopped = permit.check(first.usage);
    if (stopped) rejectBudget(stopped);
  }
  const receipt = await replayInContainer(turns, options, connect);
  return { turns: turns.slice(0, receipt.completed), stopped: receipt.stopped };
}

async function confirmContainerTurn(
  turn: PlannedTurn,
  options: ReplayGuardrails,
  connect: ConnectDocker | undefined,
  wallTimeMs: number,
): Promise<void> {
  const receipt = await replayInContainer([turn], options, connect, wallTimeMs);
  if (receipt.stopped) rejectBudget(receipt.stopped);
}

async function replayTurns(
  data: Awaited<ReturnType<typeof plan>>,
  options: ReplayGuardrails | undefined,
  guard: ReturnType<typeof guardrails> | undefined,
  progress: { applied: Set<string>; completed: number },
  container?: { connect: ConnectDocker | undefined },
): Promise<void> {
  const incremental = options?.beforeTurn || options?.afterTurn;
  const batchedOptions = container && !incremental ? options : undefined;
  const { turns, stopped } = await acceptedTurns(data.turns, batchedOptions, container?.connect);
  for (const planned of turns) {
    const { turn, usage } = planned;
    const number = progress.completed + 1;
    const permits = await options?.beforeTurn?.(number);
    const files = turn.map(([path]) => path);
    if (permits && !files.every(permits))
      throw new ReplayRefusal("outside-path-scope", "Replay left the current packet scope.");
    const confirm =
      incremental && options && container
        ? (wallTimeMs: number) => confirmContainerTurn(planned, options, container.connect, wallTimeMs)
        : undefined;
    await applyReplayTurn(data.root, turn, usage, guard, confirm);
    for (const path of files) progress.applied.add(path);
    progress.completed = number;
    if (await options?.afterTurn?.(number, files)) break;
  }
  if (stopped) rejectBudget(stopped);
}

function replayDriver(
  file: string,
  options: ReplayGuardrails | undefined,
  container?: { connect: ConnectDocker | undefined },
) {
  return {
    name: "replay",
    detect: () => Promise.resolve(true),
    version: () => Promise.resolve("1"),
    async run(input) {
      const driver = { name: "replay", version: "1" };
      const guard = options && guardrails(options);
      const progress = { applied: new Set<string>(), completed: 0 };
      try {
        await replayTurns(await plan(file, input, guard), options, guard, progress, container);
        return {
          ...success,
          result: makeResult(driver, success, [...progress.applied].sort(), undefined, progress.completed),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const output = {
          ...success,
          exitCode: 1,
          stderr: guard ? guard.redact(message) : message,
        };
        const result = guard
          ? makeResult(driver, output, [...progress.applied].sort(), undefined, progress.completed)
          : makeResult(driver, output);
        return {
          ...output,
          result: { ...result, status: "blocked" },
          stopReason: error instanceof ReplayRefusal ? error.reason : "replay-error",
        };
      }
    },
  } satisfies AgentDriver;
}

/** Replay prerecorded changes through the in-process test adapter. */
export function createReplayDriver(file: string, options?: ReplayGuardrails) {
  return replayDriver(file, options);
}

/** Apply a bounded, container-verified replay of already approved edits to the private worktree. */
export function createContainerReplayDriver(file: string, options: ReplayGuardrails, connect?: ConnectDocker) {
  return replayDriver(file, options, { connect });
}

const replayWorker = [
  '  import { createHash as hashEditedFile } from "node:crypto";',
  '  import { readFile as readWorkerFile } from "node:fs/promises";',
  '  import { createReplayDriver } from "./agent-drivers/replay.js";',
  '  const config = JSON.parse(await readWorkerFile("./config.json", "utf8"));',
  '  const output = await createReplayDriver("./recording.json", { config, packets: [], testFiles: [] }).run({',
  '    worktreePath: "./checkout", prompt: "", timeoutMs: config.budget.run.wallTimeMs,',
  "  });",
  "  const files = [];",
  "  for (const path of output.result.filesTouched) {",
  '    const contents = await readWorkerFile("./checkout/" + path);',
  '    files.push([path, hashEditedFile("sha256").update(contents).digest("hex")]);',
  "  }",
  "  process.stdout.write(JSON.stringify({ completed: output.result.turns, stopped: output.stopReason ?? null, files }));",
].join("\n");
