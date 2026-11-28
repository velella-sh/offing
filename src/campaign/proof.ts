import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJsonFile, record } from "../agent-drivers/result.js";
import { childEnvironments } from "../autopilot/limits/secrets.js";
import { checkedProof, checkSummary, digest, logEvidence, logName, PROOF_FILE } from "../proof/document.js";
import { type CampaignRepository, invalidCampaign } from "./document.js";
import { campaignTokenNames } from "./host-config.js";

const filename = "campaign-proof.json";
const maxBytes = 56 * 1024;

export async function saveCampaignProof(
  directory: string,
  row: CampaignRepository,
  files: ReadonlyMap<string, string>,
) {
  const contents = JSON.stringify({ host: row.host, name: row.name, files: Object.fromEntries(files) });
  if (Buffer.byteLength(contents) <= maxBytes) {
    await writeFile(join(directory, filename), contents, { mode: 0o600, flag: "wx", flush: true });
  }
}

async function storedProof(row: CampaignRepository) {
  if (!row.run) throw invalidCampaign("Publication requires a retained, verified campaign run.");
  const directory = join(tmpdir(), `offing-autopilot-${row.run}`);
  const value = await readJsonFile(join(directory, filename), maxBytes).catch(() => undefined);
  const document = record(value);
  if (!document) {
    throw invalidCampaign("Expected a retained campaign proof bundle within the publication size limit.");
  }
  const entries = record(document.files);
  if (document.host !== row.host || document.name !== row.name || !entries) {
    throw invalidCampaign("Campaign proof belongs to a different repository.");
  }
  const files = new Map<string, unknown>(Object.entries(entries));
  const text = files.get(PROOF_FILE);
  if (typeof text !== "string") throw invalidCampaign("Campaign proof is missing its verification record.");
  return { directory, files, text };
}

async function passingProof(text: string, pin: string) {
  const proof = await Promise.resolve()
    .then(() => checkedProof(JSON.parse(text)))
    .catch(() => {
      throw invalidCampaign("Campaign proof has an invalid verification record.");
    });
  checkSummary(proof);
  if (
    proof.outcome !== "done" ||
    proof.verify.verdict !== "passed" ||
    proof.range.base !== pin ||
    proof.range.head === pin ||
    proof.testRuns.length === 0 ||
    proof.testRuns.some(({ attempts }) => attempts.at(-1)?.status !== "passed")
  ) {
    throw invalidCampaign("Campaign proof does not bind passing tests and a changed head to the selected pin.");
  }
  return proof;
}

function validateLogs(proof: Awaited<ReturnType<typeof passingProof>>, files: ReadonlyMap<string, unknown>) {
  const names = new Set([PROOF_FILE]);
  for (const { sha256 } of logEvidence(proof)) {
    const name = logName(sha256);
    const log = files.get(name);
    if (typeof log !== "string" || digest(log) !== sha256) throw invalidCampaign("Campaign proof logs do not match.");
    names.add(name);
  }
  if (names.size !== files.size) throw invalidCampaign("Campaign proof contains files outside its evidence manifest.");
  return names;
}

export async function readCampaignProof(row: CampaignRepository, env: NodeJS.ProcessEnv) {
  const { directory, files, text } = await storedProof(row);
  const proof = await passingProof(text, row.commit);
  const names = validateLogs(proof, files);
  const { containsSecret } = childEnvironments(env, "replay", campaignTokenNames(env));
  if ([...files.values()].some((value) => typeof value !== "string" || containsSecret(value))) {
    throw invalidCampaign("Campaign proof contains protected data.");
  }
  const bundle = JSON.stringify(Object.fromEntries([...names].sort().map((name) => [name, files.get(name)])));
  return { head: proof.range.head, sha256: digest(bundle), bundle, checkout: join(directory, "checkout") };
}
