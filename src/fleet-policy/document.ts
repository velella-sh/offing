import { readFile } from "node:fs/promises";
import type { ValidateFunction } from "ajv";
import { isIsoDate } from "@velella/ebb/registry";
import { visit, type JSONPath } from "jsonc-parser";

import { ConfigError } from "../config.js";
import type { LifecyclePolicy } from "../domain.js";
import { findPackageFile, parseBoundedJson } from "../package-files.js";
import type { PolicyLayer, PolicySource, RelaxationKey } from "./merge.js";

type LayerRules = Partial<LifecyclePolicy>;

export interface FleetPolicyDocument {
  schemaVersion: "offing.fleet-policy.v1";
  allowLoosen?: RelaxationKey[];
  policy: LayerRules;
  teams?: Record<string, { policy: LayerRules; repositories?: string[] }>;
}

export interface LocatedPolicy {
  document: FleetPolicyDocument;
  source: PolicyLayer["source"];
}

let validator: Promise<ValidateFunction<FleetPolicyDocument>> | undefined;

async function schemaValidator(): Promise<ValidateFunction<FleetPolicyDocument>> {
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const path = await findPackageFile("schemas/fleet-policy.v1.schema.json", import.meta.url);
  const schema: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("The packaged fleet policy schema must be an object.");
  }
  return new Ajv2020({ ownProperties: true }).addFormat("date", isIsoDate).compile<FleetPolicyDocument>(schema);
}

export function policyLocations(text: string, file: string): PolicyLayer["source"] {
  const lines = new Map<string, number>();
  const add = (_offset: number, _length: number, line: number, _column: number, path: () => JSONPath) => {
    lines.set(JSON.stringify(path()), line + 1);
  };
  visit(text, {
    onObjectBegin: add,
    onArrayBegin: add,
    onObjectProperty(key, offset, length, line, column, path) {
      add(offset, length, line, column, () => [...path(), key]);
    },
  });
  return (path): PolicySource => ({ file, line: lines.get(JSON.stringify(path)) ?? 1 });
}

export async function parseFleetPolicy(text: string, file: string): Promise<LocatedPolicy> {
  const parsed = parseBoundedJson(text);
  if (parsed === undefined || parsed.skipped) {
    throw new ConfigError(`Invalid fleet policy in ${file}: ${parsed?.skipped?.detail ?? "expected strict JSON"}.`);
  }
  const raw = parsed.value;
  const check = await (validator ??= schemaValidator());
  if (!check(raw)) {
    const issue = check.errors?.[0];
    throw new ConfigError(
      `Invalid fleet policy in ${file} ${issue?.instancePath ?? ""}: ${issue?.message ?? "invalid document"}.`,
    );
  }
  return { document: raw, source: policyLocations(text, file) };
}

export function makePolicyLayer(
  name: PolicyLayer["name"],
  value: LayerRules | undefined,
  source: PolicyLayer["source"],
  prefix: readonly (string | number)[] = ["policy"],
): PolicyLayer {
  return {
    name,
    rules: value?.rules ?? [],
    exceptions: value?.exceptions ?? [],
    source: (path) => source([...prefix, ...path]),
  };
}

export function pickTeam(located: LocatedPolicy, repository: string, owners: readonly string[]): string | undefined {
  const teams = located.document.teams ?? {};
  const names = Object.keys(teams);
  const explicit = names.filter((name) => teams[name]?.repositories?.includes(repository));
  const fromOwners = names.filter((name) =>
    owners.some((owner) => owner.startsWith("@") && owner.split("/")[1] === name),
  );
  const matches = explicit.length ? explicit : fromOwners;
  if (matches.length > 1) {
    throw new ConfigError(
      `${located.source(["teams"]).file}: multiple fleet policy teams match ${repository}: ${matches.sort().join(", ")}.`,
    );
  }
  return matches[0];
}
