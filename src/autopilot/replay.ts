import { findingFingerprint } from "../baseline.js";
import { compareFindings } from "../diff.js";
import type { ScanResult } from "../domain.js";
import { digest } from "../proof/document.js";
import type { ContainerTestResult, prepareContainerTestRun } from "../test-runners/consumer.js";
import { identifyScan } from "../verify-result.js";
import { createPathScope } from "./limits/scope.js";
import { createReplayDriver } from "../agent-drivers/replay.js";
import { loadConfig } from "../config.js";
import { buildFindingPacket } from "../migrate/prompt.js";
import { parseAutopilotConfig } from "./limits/config.js";
import { childEnvironments } from "./limits/secrets.js";
import {
  acceptsBaseline,
  latestFailures,
  planAutopilot,
  replayLoopPrompt,
  testsPass,
  type PlanOptions,
} from "./plan.js";
import { advanceRun, type AutopilotRun, type Selection } from "./state.js";
import {
  commitCodemods,
  commitReplayTurn,
  recordLoopEvidence,
  scanLoopCheckout,
  trackedAutopilotTestFiles,
  type AutopilotCheckout,
} from "./worktree.js";

function protectSelection(run: AutopilotRun, selection: Selection, redact: (text: string) => string): void {
  const { target } = selection;
  run.selection = {
    wave: selection.wave,
    findingIds: [...new Set(selection.findingIds.map(redact))],
    ...(target ? { target: { runtime: redact(target.runtime), version: redact(target.version) } } : {}),
  };
}

/** Apply recorded edit data to the private worktree. Replay has no model, shell commands, or test execution. */
export async function prepareReplay(
  tree: string,
  file: string,
  run: AutopilotRun,
  started: number,
  { scan, selection }: Awaited<ReturnType<typeof planAutopilot>>,
) {
  const config = (await loadConfig(tree))?.autopilot ?? parseAutopilotConfig(undefined);
  const packets = await Promise.all(selection.findingIds.map((id) => buildFindingPacket(scan, id, tree)));
  const { redact } = childEnvironments(process.env, "replay", config.secretEnv);
  protectSelection(run, selection, redact);
  const testFiles = await trackedAutopilotTestFiles(tree);
  advanceRun(run, "agent-turn");
  const output = await createReplayDriver(file, { config, packets, testFiles, started }).run({
    worktreePath: tree,
    prompt: "",
    timeoutMs: config.budget.run.wallTimeMs,
  });
  advanceRun(run, { stop: "stopReason" in output ? output.stopReason : "replay-prepared" });
  return output.exitCode === 0;
}

interface LoopOptions {
  file: string;
  selection: PlanOptions;
  allowedBaseline: ReadonlySet<string>;
  started: number;
}

type TestPlan = Awaited<ReturnType<typeof prepareContainerTestRun>>;
type PhaseTests = (name: string) => Promise<ContainerTestResult[]>;
type RunTests = (tree: string, deadline: number) => Promise<ContainerTestResult[]>;

function stop(run: AutopilotRun, reason: string): false {
  advanceRun(run, { stop: reason });
  return false;
}

async function baselinePlan(tree: string, run: AutopilotRun): Promise<TestPlan | undefined> {
  try {
    const { prepareContainerTestRun } = await import("../test-runners/consumer.js");
    return await prepareContainerTestRun(tree, true);
  } catch {
    stop(run, "container-tests-unavailable");
    return undefined;
  }
}

function currentFindings(before: ScanResult, after: ScanResult, selected: ReadonlySet<string>) {
  const pending = after.findings.filter((finding) => selected.has(findingFingerprint(finding)));
  const introduced = compareFindings(before.findings, after.findings).introduced;
  return pending.concat(introduced.filter((item) => !pending.some(({ id }) => id === item.id)));
}

function recordTests(
  test: TestPlan,
  checkout: AutopilotCheckout,
  deadline: number,
  redact: (value: string) => string,
): PhaseTests {
  return async (name) => {
    const runs = await test.run(deadline);
    await recordLoopEvidence(checkout, `${name}-tests.json`, runs, redact);
    return runs;
  };
}

interface LoopState {
  scan: ScanResult;
  tests: ContainerTestResult[];
  touched: readonly string[];
  previous?: string;
}

async function progressId(checkout: AutopilotCheckout, tests: readonly ContainerTestResult[]) {
  // Every compared turn shares one base. Equal Git trees therefore represent equal net diffs.
  const tree = (await checkout.git("rev-parse", "HEAD^{tree}")).trim();
  const failures = [...new Set(latestFailures(tests).map(({ name, file }) => JSON.stringify([name, file])))].sort();
  const statuses = tests.map(({ command, attempts }) => [command, attempts.at(-1)?.status, attempts.at(-1)?.exitCode]);
  return digest(JSON.stringify([tree, failures, statuses]));
}

async function replayPhase(
  checkout: AutopilotCheckout,
  run: AutopilotRun,
  test: TestPlan,
  options: LoopOptions,
  before: ScanResult,
  selected: ReadonlySet<string>,
  state: LoopState,
  testPhase: PhaseTests,
) {
  const { config } = test;
  const { redact } = childEnvironments(process.env, "replay", config.secretEnv);
  const testFiles = await trackedAutopilotTestFiles(before.root);
  const pending = () => currentFindings(before, state.scan, selected);
  const packets = () => Promise.all(pending().map(({ id }) => buildFindingPacket(state.scan, id, before.root)));
  const complete = () => testsPass(state.tests) && pending().length === 0;
  if (complete()) return finishVerified(run);
  const driver = createReplayDriver(options.file, {
    config,
    packets: await packets(),
    testFiles,
    started: options.started,
    async beforeTurn(number) {
      advanceRun(run, "agent-turn");
      const remaining = await packets();
      const prompt = replayLoopPrompt(remaining, state.tests, state.touched, redact);
      await recordLoopEvidence(checkout, `turn-${number}-prompt.json`, { prompt }, redact);
      return createPathScope(config, remaining, testFiles);
    },
    afterTurn: (number, files) => afterReplayTurn(checkout, run, state, testPhase, complete, number, files),
  });
  const output = await driver.run({ prompt: "", worktreePath: before.root, timeoutMs: config.budget.run.wallTimeMs });
  if (run.stopReason || complete()) return run.state === "done";
  return stop(run, ("stopReason" in output && output.stopReason) || "recording-exhausted");
}

function finishVerified(run: AutopilotRun): true {
  advanceRun(run, "verify");
  advanceRun(run, "done");
  return true;
}

async function afterReplayTurn(
  checkout: AutopilotCheckout,
  run: AutopilotRun,
  state: LoopState,
  testPhase: PhaseTests,
  complete: () => boolean,
  number: number,
  files: readonly string[],
): Promise<boolean> {
  await commitReplayTurn(checkout, files, number);
  state.touched = files;
  advanceRun(run, "tests");
  const tests = await testPhase(`turn-${number}`).catch(() => undefined);
  if (!tests) {
    stop(run, "container-tests-unavailable");
    return true;
  }
  state.tests = tests;
  state.scan = await scanLoopCheckout(state.scan.root);
  if (complete()) return finishVerified(run);
  const id = await progressId(checkout, state.tests);
  if (id === state.previous) {
    stop(run, "no-progress");
    return true;
  }
  state.previous = id;
  return false;
}

/** Explicit replay using only the pinned container test plan and local, reviewable commits. */
export async function runReplayLoop(
  tree: string,
  checkout: AutopilotCheckout,
  run: AutopilotRun,
  options: LoopOptions,
  runTests?: RunTests,
) {
  const test = await baselinePlan(tree, run);
  if (!test) return false;
  if (test.config.tests.length === 0) return stop(run, "test-approval-required");
  const { scan, selection } = await planAutopilot(tree, run, options.selection);
  const before = await identifyScan(scan);
  if (!before.identity?.commit) return stop(run, "checkout-identity-unavailable");
  const selectionIds = new Set(selection.findingIds);
  const selected = new Set(before.findings.filter(({ id }) => selectionIds.has(id)).map(findingFingerprint));
  const { config } = test;
  const { redact, containsSecret } = childEnvironments(process.env, "replay", config.secretEnv);
  protectSelection(run, selection, redact);
  const recordedPlan = runTests ? { config, run: (deadline: number) => runTests(tree, deadline) } : test;
  const runPhase = recordTests(recordedPlan, checkout, options.started + config.budget.run.wallTimeMs, redact);
  advanceRun(run, "baseline-tests");
  const baseline = await runPhase("baseline").catch(() => undefined);
  if (!baseline) return stop(run, "container-tests-unavailable");
  if (!acceptsBaseline(baseline, options.allowedBaseline)) return stop(run, "baseline-tests-failed");
  advanceRun(run, "codemods");
  const packets = await Promise.all(selection.findingIds.map((id) => buildFindingPacket(before, id, tree)));
  const permits = createPathScope(config, packets, await trackedAutopilotTestFiles(tree));
  const after = await commitCodemods(checkout, before, selectionIds, permits, containsSecret, redact).catch(
    () => undefined,
  );
  if (!after) return stop(run, "codemod-error");
  advanceRun(run, "tests");
  const tests = after === before ? baseline : await runPhase("codemods").catch(() => undefined);
  if (!tests) return stop(run, "container-tests-unavailable");
  return replayPhase(checkout, run, test, options, before, selected, { scan: after, tests, touched: [] }, runPhase);
}
