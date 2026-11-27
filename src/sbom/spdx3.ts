import { createHash } from "node:crypto";

import { parsePurl } from "@velella/ebb/purl";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { checkAgainst } from "../check-dependency.js";
import type { DependencyFinding } from "../check-dependency.js";
import { required } from "../required.js";
import { lifecycleRules, milestoneCandidates, milestoneNames } from "./lifecycle.js";
import { SpdxError } from "./spdx.js";

type JsonObject = Record<string, unknown>;

const CONTEXT = "https://spdx.org/rdf/3.0.1/spdx-context.jsonld";
const PROFILE = "offing:lifecycle:v1";
const AUTHOR = "urn:offing:lifecycle:organization";

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSpdx3(input: unknown): input is JsonObject {
  return object(input) && input["@context"] === CONTEXT;
}

function creationInfo(date: string): JsonObject {
  return { type: "CreationInfo", created: `${date}T00:00:00Z`, createdBy: [AUTHOR], specVersion: "3.0.1" };
}

function annotation(subject: string, finding: DependencyFinding): JsonObject {
  const date = required(finding.deadline, "the deadline");
  const statement = JSON.stringify({
    ruleId: finding.ruleId,
    milestone: required(milestoneNames[finding.event], "the milestone"),
    date,
    sources: [...new Set(finding.sources.map(({ url }) => url))],
    ...(finding.replacement ? { replacement: finding.replacement } : {}),
  });
  const digest = createHash("sha256")
    .update(JSON.stringify([subject, statement]))
    .digest("hex");
  const accessedAt = finding.sources[0]?.accessedAt ?? date;
  return {
    type: "Annotation",
    spdxId: `urn:offing:lifecycle:annotation:${digest}`,
    annotationType: "other",
    subject,
    contentType: "application/json",
    comment: PROFILE,
    statement,
    creationInfo: creationInfo(accessedAt),
  };
}

function findingsFor(purl: string, version: unknown, rules: readonly RegistryV2Rule[]): DependencyFinding[] {
  try {
    const resolved = parsePurl(purl).version ?? version;
    const result = checkAgainst(rules, {
      purl,
      ...(typeof resolved === "string" && resolved ? { version: resolved } : {}),
    });
    return result.status === "affected" ? result.findings : [];
  } catch (error) {
    throw new SpdxError(`Cannot match package ${purl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function annotationsFor(pkg: JsonObject, rules: readonly RegistryV2Rule[]): JsonObject[] {
  if (pkg.type !== "software_Package" || pkg.software_packageUrl === undefined) return [];
  const { spdxId, software_packageUrl: purl, software_packageVersion: version } = pkg;
  if (typeof spdxId !== "string" || !URL.canParse(spdxId) || typeof purl !== "string") {
    throw new SpdxError("SPDX 3 packages with a Package URL need an absolute spdxId and a string Package URL.");
  }
  if (version !== undefined && typeof version !== "string") {
    throw new SpdxError("SPDX 3 software_packageVersion must be a string.");
  }
  const findings = findingsFor(purl, version, rules);
  if (findings.length === 0) return [];
  const references = pkg.externalRef === undefined ? [] : pkg.externalRef;
  if (!Array.isArray(references) || !references.every(object)) {
    throw new SpdxError("SPDX 3 externalRef must be an array of objects.");
  }
  for (const { url, title } of findings.flatMap(({ sources }) => sources)) {
    if (references.some(({ locator }) => Array.isArray(locator) && locator.includes(url))) continue;
    references.push({ type: "ExternalRef", externalRefType: "documentation", locator: [url], comment: title });
  }
  pkg.externalRef = references;
  return findings.map((finding) => annotation(spdxId, finding));
}

function updateDocuments(graph: JsonObject[], additions: JsonObject[]): void {
  for (const node of graph) {
    if (node.type !== "SpdxDocument" || !Array.isArray(node.element)) continue;
    const elements: unknown[] = node.element;
    const ids = new Set(elements.map((element) => (object(element) ? element.spdxId : element)));
    const annotations = additions.filter(({ subject }) => ids.has(subject));
    if (annotations.length === 0) continue;
    node.element = [...elements, ...[AUTHOR, ...annotations.map(({ spdxId }) => spdxId)].filter((id) => !ids.has(id))];
  }
}

/** Enrich the SPDX 3.0.1 compact JSON-LD graph without resolving the context or external IDs. */
export function enrichSpdx3(input: JsonObject, rules: readonly RegistryV2Rule[]): JsonObject {
  const copy = structuredClone(input);
  const { "@context": context, "@graph": existing, ...element } = copy;
  const graph = existing === undefined ? [element] : existing;
  if (!Array.isArray(graph) || !graph.every(object)) throw new SpdxError("SPDX 3 @graph must be an array of objects.");
  const candidates = milestoneCandidates(rules);
  const ids = new Set(graph.map(({ spdxId }) => spdxId));
  const additions = graph
    .flatMap((node) => annotationsFor(node, candidates))
    .filter(({ spdxId }) => {
      if (ids.has(spdxId)) return false;
      ids.add(spdxId);
      return true;
    });
  const first = additions[0];
  if (!first) return copy;
  updateDocuments(graph, additions);
  if (!ids.has(AUTHOR)) {
    graph.push({ type: "Organization", spdxId: AUTHOR, name: "Velella", creationInfo: first.creationInfo });
  }
  graph.push(...additions);
  return existing === undefined ? { "@context": context, "@graph": graph } : copy;
}

export async function enrichSpdx3WithActiveData(input: JsonObject): Promise<JsonObject> {
  return enrichSpdx3(input, await lifecycleRules());
}
