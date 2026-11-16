import { purlIdentity } from "@velella/ebb/purl";

import type { SourceLocation } from "../../src/domain.js";

export interface Reference {
  purl: string;
  version: string | undefined;
  location: SourceLocation;
}

export function reference(identity: string, version: string | undefined, path: string, line?: number): Reference {
  return { purl: purlIdentity(identity), version, location: line === undefined ? { path } : { path, line } };
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
