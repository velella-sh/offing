import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isIsoDate } from "@velella/ebb/registry";

import { daysBetween } from "../baseline.js";
import type { CheckStatus } from "../check-dependency.js";
import { OffingError } from "../offing-error.js";
import { findPackageFile, parseBoundedJson } from "../package-files.js";
import { artifactSubject, type ComponentIdentity, type LifecycleStatement } from "./statement.js";

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const SIGSTORE_BUNDLE = /^application\/vnd\.dev\.sigstore\.bundle(?:\+json;version=0\.[12]|\.v0\.3\+json)$/;
const PAYLOAD_TYPE = "application/vnd.in-toto+json";

let validator: Promise<ValidateFunction<LifecycleStatement>> | undefined;

export interface AttestationCheck {
  statement: LifecycleStatement;
  asOf: string;
  envelope: "statement" | "sigstore-bundle";
  components: Array<
    ComponentIdentity & {
      status: CheckStatus;
      rules: Array<{ ruleId: string; date?: string; daysLeft?: number }>;
    }
  >;
}

const bad = (message: string): OffingError => new OffingError("invalid-input", message);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

async function loadValidator(): Promise<ValidateFunction<LifecycleStatement>> {
  const file = await findPackageFile("schemas/lifecycle-attestation.v1.schema.json", import.meta.url);
  const schema: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isRecord(schema)) throw new Error("Expected a packaged lifecycle attestation JSON schema.");
  // The schema's URI fields are absolute HTTPS URLs without credentials or whitespace.
  return new Ajv2020({ ownProperties: true, strictRequired: false })
    .addFormat("date", isIsoDate)
    .addFormat(
      "uri",
      (url: string) =>
        /^https:\/\/[^\s]+$/u.test(url) && URL.canParse(url) && !new URL(url).username && !new URL(url).password,
    )
    .compile<LifecycleStatement>(schema);
}

function strictJson(text: string): unknown {
  const document = parseBoundedJson(text);
  if (!document || document.skipped) throw bad(document?.skipped?.detail ?? "Expected strict JSON.");
  return document.value;
}

async function readAttestation(file: string): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error("Expected a regular file.");
    if (metadata.size > MAX_DOCUMENT_BYTES) throw new Error("Attestation exceeds the 64 MiB input limit.");
    const stream: AsyncIterable<Buffer> = createReadStream(file);
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_DOCUMENT_BYTES) throw new Error("Attestation exceeds the 64 MiB input limit.");
      chunks.push(chunk);
    }
    return strictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    throw bad(
      `Cannot read attestation ${JSON.stringify(file)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function unwrap(input: unknown): { envelope: AttestationCheck["envelope"]; statement: unknown } {
  if (!isRecord(input) || !Object.hasOwn(input, "mediaType")) return { envelope: "statement", statement: input };
  if (typeof input.mediaType !== "string" || !SIGSTORE_BUNDLE.test(input.mediaType)) {
    throw bad("Unsupported Sigstore bundle media type.");
  }
  const envelope = input.dsseEnvelope;
  if (!isRecord(envelope) || envelope.payloadType !== PAYLOAD_TYPE || typeof envelope.payload !== "string") {
    throw bad("Expected a Sigstore DSSE envelope with an in-toto JSON payload.");
  }
  const bytes = Buffer.from(envelope.payload, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== envelope.payload) {
    throw bad("Sigstore payload must be canonical padded base64.");
  }
  try {
    return {
      envelope: "sigstore-bundle",
      statement: strictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch (error) {
    if (error instanceof OffingError) throw error;
    throw bad("Sigstore payload must be valid UTF-8.");
  }
}

function project(statement: LifecycleStatement, asOf: string): AttestationCheck["components"] {
  const { builtOn, components, noData } = statement.predicate;
  const checked = components.map(({ rules, ...component }) => {
    const knownRules = new Set<string>();
    const projected = rules.map(({ ruleId, date, daysLeftAtBuild }) => {
      if (knownRules.has(ruleId)) throw bad(`Repeated rule ${ruleId} for ${component.purl}.`);
      knownRules.add(ruleId);
      if (!date) return { ruleId };
      if (daysBetween(builtOn, date) !== daysLeftAtBuild) {
        throw bad(`Inconsistent daysLeftAtBuild for ${component.purl} rule ${ruleId}.`);
      }
      return { ruleId, date, daysLeft: daysBetween(asOf, date) };
    });
    return { ...component, rules: projected };
  });
  return [...checked, ...noData.map((identity) => ({ ...identity, status: "no-data" as const, rules: [] }))];
}

export async function validateStatement(value: unknown): Promise<LifecycleStatement> {
  const validate = await (validator ??= loadValidator());
  if (!validate(value)) {
    const problem = validate.errors?.[0];
    throw bad(
      `Invalid lifecycle statement at ${problem?.instancePath || "/"}: ${problem?.message ?? "invalid document"}.`,
    );
  }
  return value;
}

export async function checkAttestation(file: string, asOf: string, subject?: string): Promise<AttestationCheck> {
  if (!isIsoDate(asOf)) throw new OffingError("invalid-date", "Expected a real UTC calendar date (YYYY-MM-DD).");
  const { statement: payload, envelope } = unwrap(await readAttestation(file));
  const statement = await validateStatement(payload);
  if (subject !== undefined) {
    const expected = await artifactSubject(subject);
    if (!statement.subject.some((entry) => entry.digest.sha256 === expected.digest.sha256)) {
      throw bad("Artifact SHA-256 digest does not match an attestation subject.");
    }
  }
  return { statement, envelope, asOf, components: project(statement, asOf) };
}
