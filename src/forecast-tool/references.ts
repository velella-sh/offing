import { purlIdentity } from "@velella/ebb/purl";

import type { SourceLocation } from "../domain.js";

export interface Reference {
  purl: string;
  version: string | undefined;
  location: SourceLocation;
  runtime?: { kind: "node-manifest"; range: string } | { kind: "python-install" };
}

export function reference(identity: string, version: string | undefined, path: string, line?: number): Reference {
  return { purl: purlIdentity(identity), version, location: line === undefined ? { path } : { path, line } };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
