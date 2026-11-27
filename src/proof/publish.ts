import { childEnvironments } from "../autopilot/limits/secrets.js";
import {
  checkedProof,
  checkSummary,
  digest,
  invalid,
  logEvidence,
  logName,
  MAX_LOG_BYTES,
  MAX_PROOF_BYTES,
  PROOF_FILE,
  type Proof,
} from "./document.js";

export type { Proof } from "./document.js";

const marker = "<!-- offing-proof:v1 -->";
const inlineBytes = 48 * 1024;

function renderSummary(proof: Proof): string {
  const turns = proof.agentRuns.map((run) => run.turns);
  const testStatuses = proof.testRuns.map(({ attempts }) => attempts.at(-1)?.status);
  const passed = testStatuses.filter((status) => status === "passed").length;
  const { elapsedMs, costUsd } = proof.budget;
  const knownTurns = turns.reduce((sum: bigint, value) => sum + BigInt(value ?? 0), 0n);
  const unknown = turns.filter((value) => value === null).length;
  const cost = costUsd === null ? "unreported" : `USD ${costUsd}`;
  return [
    "## Offing migration proof",
    "",
    `- Outcome — ${proof.outcome} (verification ${proof.verify.verdict})`,
    `- Agent runs — ${turns.length}, ${knownTurns} reported turns, ${unknown} runs with unreported turns`,
    `- Test runs — ${passed} passed of ${testStatuses.length}`,
    `- Budget used — ${elapsedMs} ms, ${cost}`,
  ].join("\n");
}

function renderBody(proof: Proof, json: string): string {
  const fenced = "```json\n" + json + "```\n";
  const evidence =
    Buffer.byteLength(fenced) <= inlineBytes ? fenced : `Artifact: \`${PROOF_FILE}\` (SHA-256 \`${digest(json)}\`).\n`;
  return `${renderSummary(proof)}\n\n${marker}\n${evidence}`;
}

function omitTails(proof: Proof): void {
  for (const run of proof.testRuns) {
    for (const attempt of run.attempts) {
      attempt.logs.stdout.tail = "";
      attempt.logs.stderr.tail = "";
    }
  }
}

function protectLogs(proof: Proof, source: ReadonlyMap<string, string>, redact: (text: string) => string) {
  const protectedDigests = new Map<string, string>();
  const files = new Map<string, string>();
  omitTails(proof);
  for (const { sha256, label } of logEvidence(proof)) {
    if (protectedDigests.has(sha256)) continue;
    const log = source.get(sha256);
    if (log === undefined || Buffer.byteLength(log) > MAX_LOG_BYTES || digest(log) !== sha256) {
      throw invalid(`Expected matching source log evidence for ${label}.`);
    }
    const safe = redact(log);
    if (Buffer.byteLength(safe) > MAX_LOG_BYTES) throw invalid(`Redacted log exceeds the limit for ${label}.`);
    const safeDigest = digest(safe);
    protectedDigests.set(sha256, safeDigest);
    files.set(logName(safeDigest), safe);
  }
  return { protectedDigests, files };
}

function replaceDigests(proof: Proof, digests: ReadonlyMap<string, string>): void {
  for (const command of proof.verify.commands) {
    if (command.logSha256) command.logSha256 = digests.get(command.logSha256) ?? command.logSha256;
  }
  for (const run of proof.testRuns) {
    for (const attempt of run.attempts) {
      for (const log of [attempt.logs.stdout, attempt.logs.stderr]) log.sha256 = digests.get(log.sha256) ?? log.sha256;
    }
  }
}

/** Prepare the only bytes a publisher should write. The input result and original log map are left untouched. */
export async function prepareProofPublication(
  proof: Proof,
  logs: ReadonlyMap<string, string>,
  source: NodeJS.ProcessEnv,
  secretEnv: readonly string[],
): Promise<{ body: string; files: ReadonlyMap<string, string> }> {
  const checked = structuredClone(await checkedProof(proof));
  checkSummary(checked);
  const { redact } = childEnvironments(source, "replay", secretEnv);
  const { protectedDigests, files } = protectLogs(checked, logs, redact);
  replaceDigests(checked, protectedDigests);
  const redacted = JSON.stringify(
    checked,
    (_key, value: unknown) => (typeof value === "string" ? redact(value) : value),
    2,
  );
  const safe = await checkedProof(JSON.parse(redacted));
  checkSummary(safe);
  const json =
    redacted.replace(
      /[<>`\u2028\u2029]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ) + "\n";
  if (Buffer.byteLength(json) > MAX_PROOF_BYTES) throw invalid("Redacted proof exceeds the 8 MiB limit.");
  files.set(PROOF_FILE, json);
  return { body: renderBody(safe, json), files };
}
