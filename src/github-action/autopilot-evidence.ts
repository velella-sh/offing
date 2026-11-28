import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkedResult, readJsonFile } from "../agent-drivers/result.js";
import { childEnvironments } from "../autopilot/limits/secrets.js";
import type { AutopilotRun } from "../autopilot/state.js";
import { git } from "../fix/git.js";
import { checkedTestRun, checkedVerifyResult, digest, MAX_PROOF_BYTES, type Proof } from "../proof/document.js";
import { prepareAutopilotProofPublication } from "../proof/publish.js";
import { VERSION } from "../version.js";

export function autopilotEvidence(source: NodeJS.ProcessEnv, initialSecrets: readonly string[]) {
  let names = initialSecrets;
  let redact = childEnvironments(source, "replay", names).redact;
  const logs = new Map<string, string>();
  let bytes = 0;
  return {
    configure(secretEnv: readonly string[]) {
      names = [...new Set([...initialSecrets, ...secretEnv])];
      redact = childEnvironments(source, "replay", names).redact;
    },
    capture: (raw: string) => {
      const safe = redact(raw);
      const sha = digest(safe);
      if (!logs.has(sha)) {
        bytes += Buffer.byteLength(safe);
        if (bytes > 16 * 1024 * 1024) throw new Error("Autopilot test logs exceed the proof capture budget.");
        logs.set(sha, safe);
      }
      return safe;
    },
    async publish(root: string, directory: string, run: AutopilotRun) {
      return terminalProof(root, directory, run, logs, source, names);
    },
  };
}

async function testEvidence(read: (name: string) => Promise<unknown>, verify: Proof["verify"], turn: number) {
  const tests =
    turn > 0
      ? await read(`turn-${turn}-tests.json`)
      : ((await read("codemods-tests.json").catch(() => undefined)) ?? (await read("baseline-tests.json")));
  if (!Array.isArray(tests)) throw new Error("Autopilot did not record test evidence.");
  const testRuns = await Promise.all(tests.map(checkedTestRun));
  const linked = new Set<number>();
  const commandResults = verify.commands.map(({ command }, commandIndex) => {
    const testRunIndex = testRuns.findIndex(
      (run, index) => !linked.has(index) && JSON.stringify(run.command) === command,
    );
    linked.add(testRunIndex);
    return { commandIndex, testRunIndex };
  });
  return { testRuns, commandResults };
}

async function terminalProof(
  root: string,
  directory: string,
  run: AutopilotRun,
  logs: ReadonlyMap<string, string>,
  source: NodeJS.ProcessEnv,
  names: readonly string[],
) {
  const progress = run.replay;
  if (!progress) throw new Error("Autopilot did not record a terminal verification.");
  const read = (name: string) => readJsonFile(join(directory, name), MAX_PROOF_BYTES);
  const verify = await checkedVerifyResult(await read("final-verify-result.json"));
  const attempts = run.transitions.filter((phase) => phase === "agent-turn").length;
  const agentRuns = await Promise.all(
    Array.from({ length: attempts }, async (_, index) => checkedResult(await read(`turn-${index + 1}-agent.json`))),
  );
  const tests = await testEvidence(read, verify, progress.turn);
  const tools = { offing: VERSION, git: (await git(root, ["--version"])).trim() };
  const budget = { elapsedMs: progress.elapsedMs, costUsd: progress.usage.costCents / 100 };
  return prepareAutopilotProofPublication(
    run,
    { repo: root, verify, agentRuns, tools, budget, ...tests },
    logs,
    source,
    names,
  );
}

export async function writeAutopilotArtifact(files: ReadonlyMap<string, string>, temporary?: string) {
  const directory = await mkdtemp(join(temporary || tmpdir(), "offing-action-proof-"));
  await Promise.all(
    [...files].map(([name, bytes]) => writeFile(join(directory, name), bytes, { flag: "wx", mode: 0o600 })),
  );
  return directory;
}
