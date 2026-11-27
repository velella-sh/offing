import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";

import type { ActionVersions } from "./parse-workflow.js";
import { isRecord, record } from "./references.js";

export interface ForecastSignature {
  publicKey: string;
  signature: string;
}

export interface ForecastData {
  version: string;
  rules: RegistryV2Rule[];
  actionVersions: ActionVersions;
}

function base64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function parseActionVersions(value: unknown): ActionVersions {
  const { actions } = record(value);
  if (!isRecord(actions)) throw new Error("The Ebb bundle is missing the GitHub Actions version map.");
  return new Map(
    Object.entries(actions).map(([action, versions]) => {
      if (!isRecord(versions)) throw new Error("The Ebb bundle has an invalid GitHub Actions version map.");
      const pairs = Object.entries(versions).map(([sha, version]): [string, string] => {
        if (typeof version !== "string") throw new Error("The Ebb bundle has an invalid GitHub Actions version.");
        return [sha, version];
      });
      return [action, new Map(pairs)];
    }),
  );
}

/** Verify the release bytes with the Ebb signing key authenticated during the site build. */
export async function verifyBundle(bytes: ArrayBuffer, release: ForecastSignature): Promise<ForecastData> {
  const key = await crypto.subtle.importKey(
    "spki",
    base64(release.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64(release.signature),
    bytes,
  );
  if (!verified) throw new Error("The Ebb data signature could not be verified.");

  const contents: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const bundle = record(contents);
  const { version } = record(bundle.manifest);
  if (typeof version !== "string" || !version) throw new Error("The Ebb bundle is missing a data version.");
  const files = record(bundle.files);
  const rules = ["npm", "nodejs", "python", "github-actions", "dotnet"].flatMap(
    (name) => validateRegistryV2(files[`registry/${name}.json`]).rules,
  );
  return { version, rules, actionVersions: parseActionVersions(files["registry/github-actions-shas.json"]) };
}
