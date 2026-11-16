import type { DataBundle } from "@velella/ebb/data-bundle";
import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";

import type { ActionVersions } from "./parse-workflow.js";

interface DataRelease {
  file: string;
  publicKey: string;
  signature: string;
}

declare const EBB_RELEASE: DataRelease;

export interface ForecastData {
  version: string;
  rules: RegistryV2Rule[];
  actionVersions: ActionVersions;
}

function base64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Verify the release bytes with the Ebb signing key authenticated during the site build. */
export async function verifyBundle(
  bytes: ArrayBuffer,
  release: Pick<DataRelease, "publicKey" | "signature">,
): Promise<ForecastData> {
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

  const bundle = JSON.parse(new TextDecoder().decode(bytes)) as DataBundle;
  const rules = ["npm", "nodejs", "python", "github-actions", "dotnet"].flatMap(
    (name) => validateRegistryV2(bundle.files[`registry/${name}.json`]).rules,
  );
  const shaMap = bundle.files["registry/github-actions-shas.json"] as {
    actions: Record<string, Record<string, string>>;
  };
  const actionVersions = new Map(
    Object.entries(shaMap.actions).map(([action, versions]) => [action, new Map(Object.entries(versions))]),
  );
  return { version: bundle.manifest.version, rules, actionVersions };
}

async function fetchData(): Promise<ForecastData> {
  const url = new URL(EBB_RELEASE.file, import.meta.url);
  const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("The Ebb data could not be loaded. Try again in a moment.");
  return verifyBundle(await response.arrayBuffer(), EBB_RELEASE);
}

let data: Promise<ForecastData> | undefined;

export function loadData(): Promise<ForecastData> {
  data ??= fetchData().catch((error: unknown) => {
    data = undefined;
    throw error;
  });
  return data;
}
