import { appendFile } from "node:fs/promises";

import { reconcileAutopilotPullRequest } from "./action-fix-pr.js";
import type { AutopilotConfig } from "./autopilot/limits/config.js";
import { runReplayLoop } from "./autopilot/replay.js";
import { startRun, type AutopilotRun } from "./autopilot/state.js";
import { withAutopilotWorktree } from "./autopilot/worktree.js";
import { git } from "./fix/git.js";
import { autopilotEvidence, writeAutopilotArtifact } from "./github-action/autopilot-evidence.js";
import {
  autopilotWorkspace,
  recordingFile,
  workflowBudget,
  workflowDriver,
  workflowWave,
} from "./github-action/autopilot-inputs.js";

const actionSecrets = ["OFFING_ACTION_AUTOPILOT_KEY", "INPUT_GITHUB-TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
type Location = Awaited<ReturnType<typeof withAutopilotWorktree>>;
type PublicationTarget = Parameters<typeof reconcileAutopilotPullRequest>[0];

async function output(env: NodeJS.ProcessEnv, name: string, value: string) {
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function summary(env: NodeJS.ProcessEnv, message: string) {
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, message + "\n");
}

function reportBudget(run: AutopilotRun, budget: AutopilotConfig["budget"] | undefined): string {
  const used = run.replay?.usage ?? { turns: 0, tokens: 0, costCents: 0 };
  const elapsed = run.replay?.elapsedMs ?? 0;
  const usage = `${elapsed} ms, ${used.turns} turns, ${used.tokens} tokens, ${used.costCents} cost cents`;
  const caps = budget?.run;
  const limit = caps
    ? `${caps.wallTimeMs} ms, ${caps.turns} turns, ${caps.tokens} tokens, ${caps.costCents} cost cents`
    : "unavailable";
  return [
    "### Offing Autopilot",
    "",
    `- Result — ${run.stopReason ?? run.state}`,
    `- Tests — ${run.replay?.tests ?? "not run"}`,
    `- Budget used — ${usage}`,
    `- Run limit — ${limit}`,
  ].join("\n");
}

function publicationTarget(
  env: NodeJS.ProcessEnv,
  workspace: Awaited<ReturnType<typeof autopilotWorkspace>>,
  wave: number,
): Omit<PublicationTarget, "base"> | undefined {
  if (env.INPUT_AUTOPILOT !== "true") return undefined;
  const token = env["INPUT_GITHUB-TOKEN"];
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/u.test(repository))
    throw new Error("Offing Autopilot needs a GitHub token and GITHUB_REPOSITORY to publish wave results.");
  return {
    root: workspace.root,
    baseBranch: workspace.branch,
    repository,
    token,
    wave,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    ...(env.GITHUB_GRAPHQL_URL ? { graphqlUrl: env.GITHUB_GRAPHQL_URL } : {}),
  };
}

async function publishWave(
  env: NodeJS.ProcessEnv,
  target: PublicationTarget,
  run: AutopilotRun,
  location: Location,
  evidence: ReturnType<typeof autopilotEvidence>,
) {
  const head = run.replay?.head;
  if (!head || run.replay?.tests === "unavailable") return;
  const changed = await git(location.tree, ["rev-parse", `${target.base}^{tree}`, `${head}^{tree}`]).then(
    (trees) => new Set(trees.trim().split(/\r?\n/u)).size === 2,
  );
  if (!changed) {
    if (run.state === "done") await reportPublication(env, await reconcileAutopilotPullRequest(target));
    return;
  }
  const proof = await evidence.publish(location.tree, location.directory, run);
  await output(env, "autopilot-artifact-path", await writeAutopilotArtifact(proof.files, env.RUNNER_TEMP));
  const draft = run.state !== "done";
  if (draft && env["INPUT_AUTOPILOT-OPEN-RED"] !== "true") {
    await summary(env, "- Red wave skipped. Set autopilot-open-red to true to publish a draft.");
    return;
  }
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID
      ? `\n[Workflow proof and test logs](${env.GITHUB_SERVER_URL}/${target.repository}/actions/runs/${env.GITHUB_RUN_ID}#artifacts)\n`
      : "";
  const details = draft ? `\nStopped — ${run.stopReason ?? "verification incomplete"}.\n` : "";
  await reportPublication(
    env,
    await reconcileAutopilotPullRequest(target, { head, draft, body: proof.body + details + runUrl }),
  );
}

async function reportPublication(
  env: NodeJS.ProcessEnv,
  result: Awaited<ReturnType<typeof reconcileAutopilotPullRequest>>,
) {
  await output(env, "autopilot-pr-urls", JSON.stringify(result.url ? [result.url] : []));
  await summary(env, `- Pull request — ${result.status}${result.number === undefined ? "" : ` #${result.number}`}`);
}

async function publishRun(
  env: NodeJS.ProcessEnv,
  target: Omit<PublicationTarget, "base"> | undefined,
  run: AutopilotRun,
  location: Location,
  evidence: ReturnType<typeof autopilotEvidence>,
) {
  if (!target) return;
  await output(env, "autopilot-pr-urls", "[]");
  const base = run.checkout?.baseCommit;
  if (base) await publishWave(env, { ...target, base }, run, location, evidence);
}

function requireVerifiedRun(run: AutopilotRun, branch: string) {
  if (run.stopReason === "install-pinned-claude-code")
    throw new Error(
      "Install the pinned Claude Code version from the Agent drivers guide before running Offing Autopilot.",
    );
  if (run.state !== "done") throw new Error(`Offing Autopilot stopped (${run.stopReason ?? "unknown"}).`);
  console.log(`Offing Autopilot verified in ${branch}.`);
}

export async function runActionAutopilot(
  env: NodeJS.ProcessEnv,
  runTests?: Parameters<typeof runReplayLoop>[4],
  createReplay?: Parameters<typeof runReplayLoop>[3]["createReplay"],
): Promise<boolean> {
  const key = env.OFFING_ACTION_AUTOPILOT_KEY;
  delete env.OFFING_ACTION_AUTOPILOT_KEY;
  if ((env.INPUT_AUTOPILOT ?? env.OFFING_ACTION_AUTOPILOT) !== "true") return false;
  const workspace = await autopilotWorkspace(env);
  const driver = workflowDriver(env, key);
  const wave = workflowWave(env);
  const target = publicationTarget(env, workspace, wave);
  const evidence = autopilotEvidence({ ...env, OFFING_ACTION_AUTOPILOT_KEY: key }, actionSecrets);
  const run = startRun("prepare");
  const start = performance.now();
  let budget: AutopilotConfig["budget"] | undefined;
  const runBudget = workflowBudget(env);
  const location = await withAutopilotWorktree(workspace.root, run, async (tree, checkout) => {
    if (env.GITHUB_SHA && env.GITHUB_SHA !== run.checkout?.baseCommit)
      throw new Error("Offing Autopilot requires the checkout to match GITHUB_SHA.");
    await runReplayLoop(
      tree,
      checkout,
      run,
      {
        file: driver.recording ? await recordingFile(tree, driver.recording) : "",
        selection: { wave, allowEmptyWave: true },
        allowedBaseline: new Set(),
        started: start,
        ...(driver.claude ? { claude: driver.claude } : {}),
        ...(createReplay ? { createReplay } : {}),
        runBudget,
        ...(target ? { capture: evidence.capture, secretEnv: actionSecrets } : {}),
        configure(config) {
          evidence.configure(config.secretEnv);
          budget = config.budget;
        },
      },
      runTests,
    );
  });
  await summary(env, reportBudget(run, budget));
  await publishRun(env, target, run, location, evidence);
  requireVerifiedRun(run, location.branch);
  return true;
}
