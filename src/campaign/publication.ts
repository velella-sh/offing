import { digest } from "../proof/document.js";
import {
  campaignBranch,
  type CampaignPublication,
  type CampaignRepository,
  type CampaignState,
  invalidCampaign,
} from "./document.js";
import { openForge } from "./forge.js";
import { approvedTargets, type HostPermissions, type HostTarget } from "./host-config.js";
import { createCampaignBranch } from "./host-git.js";
import type { HostHttpOptions } from "./host-http.js";
import { readCampaignProof } from "./proof.js";
import { controlCampaign, gap, transition } from "./run.js";

type Save = () => Promise<void>;
type Forge = Awaited<ReturnType<typeof openForge>>;

export interface PublicationOptions extends HostHttpOptions {
  env?: NodeJS.ProcessEnv;
  push?: typeof createCampaignBranch;
}

function draft(
  state: CampaignState,
  row: CampaignRepository,
  target: HostTarget,
  proof: Awaited<ReturnType<typeof readCampaignProof>>,
) {
  const branch = campaignBranch(state.id, row);
  const key = branch.slice("offing-campaign/".length);
  const escapedBundle = proof.bundle.replace(
    /[<>`\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const body = [
    "## Verified Offing migration",
    "",
    `Base commit: \`${row.commit}\`. Verified head: \`${proof.head}\`.`,
    "",
    `Proof bundle SHA-256: \`${proof.sha256}\`. Parse the JSON and save each value as its named file to verify the proof locally.`,
    "",
    `<!-- offing-campaign:${key} -->`,
    "",
    "```json",
    escapedBundle,
    "```",
  ].join("\n");
  if (Buffer.byteLength(body) > 60 * 1024)
    throw invalidCampaign("Campaign proof body exceeds the host publishing limit.");
  const publication: CampaignPublication = {
    branch,
    baseBranch: target.baseBranch,
    head: proof.head,
    actorId: target.actorId,
    bodySha256: digest(body),
    proofSha256: proof.sha256,
  };
  return { body, publication };
}

function scope(row: CampaignRepository, target: HostTarget) {
  const publication = row.publication;
  if (publication && (publication.baseBranch !== target.baseBranch || publication.actorId !== target.actorId)) {
    throw invalidCampaign("Campaign host permission changed after publication started.");
  }
  return publication;
}

async function exactRequest(
  row: CampaignRepository,
  publication: CampaignPublication,
  number: number,
  forge: Forge,
  save: Save,
  now: () => number,
) {
  const found = await forge.request(number, publication);
  publication.number = number;
  if (row.status === "verified") transition(row, "review", now);
  if (row.status === "review" && found.status !== "review") transition(row, found.status, now);
  await save();
  return found;
}

async function requireCurrentPin(row: CampaignRepository, target: HostTarget, forge: Forge) {
  const base = await forge.branch(target.baseBranch);
  if (base !== row.commit) {
    throw invalidCampaign("Campaign default branch differs from the approved pin.");
  }
}

function validateDraft(
  previous: CampaignPublication | undefined,
  next: CampaignPublication,
  body: string,
  target: HostTarget,
) {
  if (
    previous &&
    (previous.bodySha256 !== next.bodySha256 ||
      previous.proofSha256 !== next.proofSha256 ||
      previous.branch !== next.branch ||
      previous.head !== next.head)
  ) {
    throw invalidCampaign("Campaign proof differs from the saved publication attempt.");
  }
  if (body.includes(target.token)) throw invalidCampaign("Campaign proof contains protected data.");
}

async function ensureBranch(
  row: CampaignRepository,
  previous: CampaignPublication | undefined,
  publication: CampaignPublication,
  checkout: string,
  target: HostTarget,
  forge: Forge,
  save: Save,
  push = createCampaignBranch,
) {
  await requireCurrentPin(row, target, forge);
  const existing = previous ? undefined : await forge.find(publication.branch);
  if (existing !== undefined) throw invalidCampaign("Campaign branch already has an unrecorded review request.");
  const branch = await forge.branch(publication.branch);
  if (branch && (!previous || branch !== publication.head)) {
    throw invalidCampaign("Campaign branch already exists outside the saved publication attempt.");
  }
  if (!previous) {
    row.publication = publication;
    await save();
  }
  if (!branch) {
    await push(target, checkout, row.commit, publication.head, publication.branch);
  }
  await requireCurrentPin(row, target, forge);
  const pushed = await forge.branch(publication.branch);
  if (pushed !== publication.head) {
    throw invalidCampaign("Campaign branch did not resolve to its verified head.");
  }
}

async function publishRow(
  state: CampaignState,
  row: CampaignRepository,
  target: HostTarget,
  save: Save,
  options: PublicationOptions,
  now: () => number,
) {
  const forge = await openForge(target, options);
  const previous = scope(row, target);
  if (previous) {
    const existing = previous.number ?? (await forge.find(previous.branch));
    if (existing !== undefined) {
      await exactRequest(row, previous, existing, forge, save, now);
      return;
    }
  }
  const proof = await readCampaignProof(row, options.env ?? process.env);
  const { body, publication } = draft(state, row, target, proof);
  validateDraft(previous, publication, body, target);
  await ensureBranch(row, previous, publication, proof.checkout, target, forge, save, options.push);
  const record = previous ?? publication;
  const number = await forge.create(record, "Offing verified migration", body);
  record.number = number;
  await save();
  await exactRequest(row, record, number, forge, save, now);
}

async function observe(
  row: CampaignRepository,
  target: HostTarget,
  save: Save,
  options: PublicationOptions,
  now: () => number,
  close: boolean,
) {
  const publication = scope(row, target);
  if (!publication) return;
  const forge = await openForge(target, options);
  const number = publication.number ?? (await forge.find(publication.branch));
  if (number === undefined) {
    if (close && row.status === "verified") {
      transition(row, "cancelled", now);
      await save();
    }
    return;
  }
  let result = await exactRequest(row, publication, number, forge, save, now);
  if (close && result.status === "review") {
    await forge.close(number);
    result = await exactRequest(row, publication, number, forge, save, now);
  }
  if (!close) {
    const signals = await forge.signals(number, publication.head, result.found);
    publication.observed = { ...signals, at: new Date(now()).toISOString() };
    await save();
  }
}

async function publishBatches(
  state: CampaignState,
  targets: ReturnType<typeof approvedTargets>,
  save: Save,
  oneBatch: boolean,
  options: PublicationOptions,
  now: () => number,
) {
  if (state.rollout) return state.rollout.reason ?? `Campaign ${state.rollout.state}.`;
  let batch: number | undefined;
  for (const row of state.repositories) {
    const target = targets.get(row);
    if (!target || row.status !== "verified" || row.batch > (state.checkedBatch ?? 0)) continue;
    if (batch !== row.batch) {
      if (oneBatch && batch !== undefined) return `Published batch ${batch}.`;
      const due = gap(state, row.batch, now());
      if (due) return `Batch ${row.batch} can publish after ${due}.`;
      batch = row.batch;
    }
    // Sequential content creation keeps a host's write budget independent of the replay concurrency.
    await publishRow(state, row, target, save, options, now);
  }
  return batch === undefined ? "No verified campaign repositories are ready to publish." : `Published batch ${batch}.`;
}

export async function managePublication(
  action: "publish" | "refresh" | "cancel",
  state: CampaignState,
  permissions: HostPermissions,
  save: Save,
  oneBatch: boolean,
  options: PublicationOptions = {},
): Promise<string | undefined> {
  const now = options.now ?? Date.now;
  const targets = approvedTargets(state, permissions, options.env ?? process.env);
  if (action === "cancel" && state.rollout?.state !== "cancelled") {
    controlCampaign(state, "cancel", undefined, now);
    await save();
  }
  if (action === "publish") return publishBatches(state, targets, save, oneBatch, options, now);
  for (const [row, target] of targets) {
    if (row.publication) await observe(row, target, save, options, now, action === "cancel");
  }
}
