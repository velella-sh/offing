import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { parseAutopilotConfig } from "../autopilot/limits/config.js";
import { childEnvironments } from "../autopilot/limits/secrets.js";
import { startRun } from "../autopilot/state.js";
import { undoAutopilotWorktree, withAutopilotWorktree } from "../autopilot/worktree.js";
import { inspectDiscoveredConfig } from "../config-validate.js";
import { OffingError } from "../offing-error.js";
import { detectTestPlan, type TestPlan } from "./detect.js";
import { archiveTree, connectDocker, prepareImage, sandbox } from "./docker.js";
import { type Profile, profiles } from "./profiles.js";
import { runApprovedTest } from "./run.js";

type Command = Parameters<typeof runApprovedTest>[0];
type Run = Awaited<ReturnType<typeof runApprovedTest>>;
export type ContainerTestResult = Run;
type Step = TestPlan["steps"][number];

const testProfiles: Partial<Record<Step["tool"], Profile>> = {
  npm: "npm",
  pnpm: "npm",
  yarn: "npm",
  pytest: "python",
  tox: "python",
  go: "go",
  maven: "java",
  gradle: "java",
};

function refused(message: string): never {
  throw new OffingError("invalid-argument", message);
}

async function checkTree(root: string): Promise<void> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.length > 100_000 || entries.some((entry) => !entry.isFile() && !entry.isDirectory())) {
    refused("Container test checkout must contain only regular files and directories within the snapshot limit.");
  }
}

function checkedProfile(tests: readonly Step[]): Profile {
  const candidates = new Set(tests.map(({ tool }) => testProfiles[tool]));
  const [profile] = candidates;
  if (candidates.size !== 1 || profile === undefined) {
    refused("Choose a checkout with one supported pinned test profile. See offing doctor --tests for detection.");
  }
  return profile;
}

function offlineSetup(step: Step): Command {
  const { command, tool } = step;
  if (step.kind !== "install") return command;
  if (tool === "npm") return [...command, "--offline", "--cache", ".npm-cache", "--no-audit", "--no-fund"];
  if (tool === "pnpm" || (tool === "yarn" && command.includes("--frozen-lockfile"))) return [...command, "--offline"];
  if (tool === "pytest" || tool === "tox") return [...command, "--find-links", ".wheelhouse"];
  return command;
}

function pinnedTest(step: Step): Command {
  if (step.tool === "go") return profiles.go.test;
  if (step.tool === "maven" && step.command[0] === "mvn") return profiles.java.test;
  return step.command;
}

function nodeManager(steps: readonly Step[]): "pnpm" | "yarn" | undefined {
  if (steps.some(({ tool }) => tool === "pnpm")) return "pnpm";
  if (steps.some(({ tool, command }) => tool === "yarn" && command.includes("--immutable"))) return "yarn";
  return undefined;
}

function corepackCommands(commands: readonly Command[], manager: ReturnType<typeof nodeManager>): Command[] {
  return commands.map((command) => (command[0] === manager ? ["corepack", ...command] : command));
}

async function plannedCommands(
  tree: string,
  configured: readonly Command[],
  steps: readonly Step[],
  tests: readonly Step[],
) {
  const manager = nodeManager(steps);
  const setup =
    configured.length > 0
      ? []
      : corepackCommands(steps.filter(({ kind }) => kind === "setup" || kind === "install").map(offlineSetup), manager);
  const archive = manager && (await stat(join(tree, ".offing-corepack.tgz")).catch(() => undefined))?.isFile();
  if (archive) setup.unshift(["corepack", "install", "-g", "--cache-only", ".offing-corepack.tgz"]);
  const commands = configured.length > 0 ? configured : corepackCommands(tests.map(pinnedTest), manager);
  return { commands, setup };
}

async function executePlan(
  tree: string,
  profile: Profile,
  commands: readonly Command[],
  setup: readonly Command[],
  deadline: number,
): Promise<Run[]> {
  const configuration = await mkdtemp(join(tmpdir(), "offing-test-docker-"));
  try {
    const source = await archiveTree(tree);
    const docker = await connectDocker(configuration);
    const image = await prepareImage(docker, profile, "");
    const execute = sandbox(docker, image, source, setup);
    const results: Run[] = [];
    for (const command of commands) {
      const timeout = Math.min(120_000, Math.floor(deadline - performance.now()));
      if (timeout < 1) refused("Container test run reached its wall-time budget.");
      let attempt: 1 | 2 = 1;
      results.push(
        await runApprovedTest(
          command,
          (argv, output) => {
            const current = attempt;
            attempt = 2;
            return execute(argv, output, true, current);
          },
          timeout,
          deadline,
        ),
      );
    }
    return results;
  } finally {
    await rm(configuration, { recursive: true, force: true });
  }
}

/** Freeze the approved argv and profile before edits. Each invocation tests a fresh private snapshot. */
export async function prepareContainerTestRun(
  tree: string,
): Promise<{ config: ReturnType<typeof parseAutopilotConfig>; run(deadline: number): Promise<ContainerTestResult[]> }> {
  await checkTree(tree);
  const { report, value } = await inspectDiscoveredConfig(tree);
  if (!report.valid) refused("Fix the committed Offing configuration before running container tests.");
  const section = value && typeof value === "object" && "autopilot" in value ? value.autopilot : undefined;
  const config = parseAutopilotConfig(section);
  const { steps } = await detectTestPlan(tree, "linux");
  const tests = steps.filter(({ kind }) => kind === "test");
  const profile = checkedProfile(tests);
  const { commands, setup } = await plannedCommands(tree, config.tests, steps, tests);
  if (commands.length > 64) refused("Limit an individual test run to 64 commands.");
  return {
    config,
    async run(deadline: number) {
      await checkTree(tree);
      return executePlan(tree, profile, commands, setup, deadline);
    },
  };
}

async function runInCheckout(tree: string) {
  const plan = await prepareContainerTestRun(tree);
  const runs = await plan.run(performance.now() + plan.config.budget.run.wallTimeMs);
  const { redact } = childEnvironments(process.env, plan.config.driver, plan.config.secretEnv);
  const lines = runs.flatMap(({ command, attempts, flaky }) => [
    `${attempts.at(-1)?.status ?? "failed"} ${JSON.stringify(command.map(redact))}`,
    ...flaky.map(({ name }) => `  Flaky test: ${JSON.stringify(redact(name))}`),
  ]);
  return {
    output: lines.join("\n") + "\n",
    passed: runs.every(({ attempts }) => attempts.at(-1)?.status === "passed"),
  };
}

/** Run only the tests requested for an immutable local checkout inside the pinned Docker sandbox. */
export async function runContainerTests(root: string) {
  let result: Awaited<ReturnType<typeof runInCheckout>> | undefined;
  const location = await withAutopilotWorktree(root, startRun("prepare"), async (tree) => {
    result = await runInCheckout(tree);
  });
  await undoAutopilotWorktree(root, location.id);
  if (!result) throw new Error("Container test checkout produced no result.");
  return result;
}
