import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import {
  canonicalJson,
  computeContentDigest,
  DATA_SIGNER,
  REQUIRED_BUNDLE_PATHS,
  sha256Hex,
} from "@velella/ebb/data-bundle";
import type { ActiveData } from "@velella/ebb/data-source";
import type { LifecycleEvent } from "@velella/ebb/registry";

import { OffingError } from "../offing-error.js";

export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const PREDICATE_TYPE = "https://velella.sh/offing/attestation/v1/";
export const SHA256 = /^[0-9a-f]{64}$/;

export interface Subject {
  name?: string;
  digest: { sha256: string };
}

export interface LifecycleRule {
  ruleId: string;
  event: LifecycleEvent;
  date?: string;
  daysLeftAtBuild?: number;
  sources: string[];
  replacement?: string;
}

export interface ComponentIdentity {
  purl?: string;
  name?: string;
  version?: string;
  location?: string;
}

export interface LifecycleComponent extends ComponentIdentity {
  status: "affected" | "not-affected" | "version-dependent";
  rules: LifecycleRule[];
}

export interface LifecyclePredicate {
  builtOn: string;
  offingVersion: string;
  ebb: { version: string; digest: string; signature?: { issuer: string; identity: string; bundleUrl?: string } };
  input: "scan" | "sbom";
  components: LifecycleComponent[];
  noData: ComponentIdentity[];
}

export interface LifecycleStatement {
  _type: typeof STATEMENT_TYPE;
  subject: Subject[];
  predicateType: typeof PREDICATE_TYPE;
  predicate: LifecyclePredicate;
}

export async function artifactSubject(input: string): Promise<Subject> {
  if (input.startsWith("sha256:")) {
    const digest = input.slice("sha256:".length);
    if (digest.length !== 64 || !SHA256.test(digest)) {
      throw new OffingError("invalid-input", "Expected sha256: followed by 64 lowercase hexadecimal characters.");
    }
    return { digest: { sha256: digest } };
  }
  try {
    if (!(await stat(input)).isFile()) throw new Error("Expected a regular artifact file.");
    const hash = createHash("sha256");
    const stream: AsyncIterable<Buffer> = createReadStream(input);
    for await (const chunk of stream) hash.update(chunk);
    const name = basename(input);
    return { ...(name.trim() ? { name } : {}), digest: { sha256: hash.digest("hex") } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OffingError("invalid-input", `Cannot read subject ${JSON.stringify(input)}: ${message}`);
  }
}

export function ebbSnapshot(active: ActiveData): LifecyclePredicate["ebb"] {
  const { version, contentDigest, signer } = active.info;
  const digest =
    contentDigest ??
    computeContentDigest(
      REQUIRED_BUNDLE_PATHS.map((path) => ({ path, sha256: sha256Hex(canonicalJson(active.readSync(path))) })),
    );
  if (!signer) return { version, digest };
  const published =
    signer.issuer === DATA_SIGNER.issuer &&
    new RegExp(DATA_SIGNER.identityPattern).test(signer.identity) &&
    /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$(?![\s\S])/.test(version);
  const bundleUrl = published
    ? `https://github.com/velella-sh/ebb/releases/download/data-v${version}/ebb-data-${version}.json.sigstore.json`
    : undefined;
  return { version, digest, signature: { ...signer, ...(bundleUrl ? { bundleUrl } : {}) } };
}
