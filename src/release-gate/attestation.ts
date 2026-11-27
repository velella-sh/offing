import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import { parsePurl } from "@velella/ebb/purl";

import { checkAttestationStatement } from "../attestation/check.js";
import { artifactSubject, PREDICATE_TYPE, type ComponentIdentity } from "../attestation/statement.js";
import { OffingError } from "../offing-error.js";
import { required } from "../required.js";
import type { LifecycleObservation } from "./decision.js";

export interface AttestationTrust {
  subject: string;
  repository: string;
  signerWorkflow: string;
  trustedRoot: string;
}

const exec = promisify(execFile);
const maxBytes = 64 * 1024 * 1024;

async function localFile(file: string): Promise<string> {
  try {
    const absolute = resolve(file);
    const info = await stat(absolute);
    if (!info.isFile() || info.size > maxBytes) throw new Error("Expected a local regular file of at most 64 MiB.");
    return absolute;
  } catch (error) {
    throw new OffingError("invalid-input", `Cannot read ${JSON.stringify(file)}: ${String(error)}`);
  }
}

async function verifiedStatement(bundle: string, trust: AttestationTrust, artifact: string): Promise<unknown> {
  const args = [
    "attestation",
    "verify",
    artifact,
    "--bundle",
    await localFile(bundle),
    "--custom-trusted-root",
    await localFile(trust.trustedRoot),
    "--repo",
    trust.repository,
    "--signer-workflow",
    trust.signerWorkflow,
    "--predicate-type",
    PREDICATE_TYPE,
    "--deny-self-hosted-runners",
    "--format",
    "json",
    "--jq",
    "map(.verificationResult.statement)",
  ];
  try {
    const result = await exec("gh", args, {
      maxBuffer: maxBytes,
      timeout: 60_000,
      windowsHide: true,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
      },
    });
    const statements: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(statements) || statements.length !== 1) {
      throw new Error("Expected one verified lifecycle statement in the bundle.");
    }
    return statements[0];
  } catch (error) {
    throw new OffingError("invalid-input", `Lifecycle attestation verification failed: ${String(error)}`);
  }
}

function attestedComponent(identity: ComponentIdentity, bundle: string): LifecycleObservation {
  const component = identity.purl ?? required(identity.name, "validated component name");
  const bundledPath = basename(bundle);
  const path = identity.location && !identity.location.startsWith("/") ? identity.location : bundledPath;
  return {
    component: identity.version ? `${component}@${identity.version}` : component,
    detector: identity.purl ? parsePurl(identity.purl).type : "attestation",
    location: { path, ...(identity.location?.startsWith("/") ? { jsonPointer: identity.location } : {}) },
  };
}

export async function attestationObservations(
  bundle: string,
  trust: AttestationTrust,
  asOf: string,
): Promise<LifecycleObservation[]> {
  const artifact = resolve(trust.subject);
  const subject = await artifactSubject(artifact);
  const digest = `sha256:${subject.digest.sha256}`;
  const statement = await verifiedStatement(bundle, trust, artifact);
  const {
    statement: { predicate },
  } = await checkAttestationStatement(statement, asOf, digest, "sigstore-bundle");
  const observed = predicate.components.flatMap((identity) => {
    const base = attestedComponent(identity, bundle);
    if (identity.status === "version-dependent") return [base];
    return identity.rules.map(({ ruleId, event, date, sources }) => ({
      ...base,
      rule: { id: ruleId, event, sources, ...(date ? { date } : {}) },
    }));
  });
  const unknown = predicate.noData.map((identity) => attestedComponent(identity, bundle));
  if (predicate.components.length === 0 && unknown.length === 0) {
    unknown.push({ component: "empty lifecycle attestation", detector: "attestation" });
  }
  return [...observed, ...unknown];
}
