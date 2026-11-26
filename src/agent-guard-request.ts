import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

import type { AgentGuardRequest } from "./agent-guard.js";
import { OffingError } from "./offing-error.js";
import { findPackageFileSync } from "./package-files.js";

const SCHEMA_FILE = "schemas/agent-guard-request.v1.schema.json";

export function agentGuardRequestSchema(): Record<string, unknown> {
  const schema: unknown = JSON.parse(readFileSync(findPackageFileSync(SCHEMA_FILE, import.meta.url), "utf8"));
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Agent Guard request schema must be an object.");
  }
  return { ...schema };
}

let validate: ValidateFunction<AgentGuardRequest> | undefined;

export function parseAgentGuardRequest(request: unknown): AgentGuardRequest {
  validate ??= new Ajv2020({ ownProperties: true }).compile<AgentGuardRequest>(agentGuardRequestSchema());
  if (validate(request)) return request;
  throw new OffingError("invalid-argument", "Expected an Agent Guard v1 request with one PURL or snippet.");
}
