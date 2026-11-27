#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const PROFILE = "offing:lifecycle:v1";
const PREFIX = "offing:lifecycle:";
const CDX_MILESTONE = "cdx:lifecycle:milestone:";
const SPDX_3 = "https://spdx.org/rdf/3.0.1/spdx-context.jsonld";
const labels = new Set(["endOfLife", "endOfSupport"]);

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value, label) {
  if (value === undefined) return [];
  require(Array.isArray(value) && value.every(object), `${label}: expected an array of objects`);
  return value;
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function httpsUrl(value) {
  return nonempty(value) && URL.canParse(value) && new URL(value).protocol === "https:";
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(time.valueOf()) && time.toISOString().startsWith(value);
}

function milestone(value) {
  if (date(value)) return true;
  return (
    typeof value === "string" &&
    date(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function checkCycloneDxComponent(component) {
  require(object(component), "CycloneDX component: expected an object");
  const properties = list(component.properties, "CycloneDX properties");
  const refs = new Set(list(component.externalReferences, "CycloneDX externalReferences").map(({ url }) => url));
  let count = 0;
  const custom = new Set();
  for (const { name, value } of properties) {
    if (typeof name === "string" && name.startsWith(CDX_MILESTONE) && labels.has(name.slice(CDX_MILESTONE.length))) {
      require(milestone(value), `${name}: invalid date or timestamp`);
      continue;
    }
    if (![PREFIX + "ruleId", PREFIX + "source", PREFIX + "replacement"].includes(name)) continue;
    require(nonempty(value), `${name}: expected a nonempty string`);
    if (name === PREFIX + "source") require(httpsUrl(value) && refs.has(value), `${name}: missing HTTPS evidence reference`);
    if (name === PREFIX + "ruleId") count++;
    custom.add(name);
  }
  if (custom.size > 0) require(count > 0 && custom.has(PREFIX + "source"), "CycloneDX lifecycle properties need a rule ID and source");
  return count + list(component.components, "CycloneDX components").reduce((total, child) => total + checkCycloneDxComponent(child), 0);
}

function checkCycloneDx(document) {
  require(nonempty(document.specVersion), "CycloneDX specVersion is required");
  const components = [...list(document.components, "CycloneDX components")];
  if (document.metadata?.component !== undefined) components.push(document.metadata.component);
  return components.reduce((total, component) => total + checkCycloneDxComponent(component), 0);
}

function checkSpdx2(document) {
  let count = 0;
  for (const pkg of list(document.packages, "SPDX 2.3 packages")) {
    for (const annotation of list(pkg.annotations, "SPDX 2.3 annotations")) {
      if (typeof annotation.comment !== "string" || !annotation.comment.startsWith(PREFIX + "milestone:")) continue;
      const [label, day, extra] = annotation.comment.slice((PREFIX + "milestone:").length).split(":");
      require(labels.has(label) && date(day) && extra === undefined, "SPDX 2.3 lifecycle annotation has an invalid milestone");
      require(
        annotation.annotationType === "OTHER" && annotation.annotationDate === `${day}T00:00:00Z`,
        "SPDX 2.3 lifecycle annotation type or date does not match",
      );
      count++;
    }
  }
  return count;
}

function checkStatement(record, references) {
  require(object(record) && nonempty(record.ruleId), "SPDX 3 lifecycle statement needs a ruleId");
  require(labels.has(record.milestone) && date(record.date), "SPDX 3 lifecycle statement has an invalid milestone");
  require(Array.isArray(record.sources) && record.sources.length > 0, "SPDX 3 lifecycle statement needs sources");
  require(record.sources.every((url) => httpsUrl(url) && references.includes(url)), "SPDX 3 lifecycle statement is missing an HTTPS evidence reference");
  require(record.replacement === undefined || nonempty(record.replacement), "SPDX 3 replacement must be a nonempty string");
}

function checkSpdx3(document) {
  const graph = document["@graph"] === undefined ? [document] : list(document["@graph"], "SPDX 3 @graph");
  const packages = new Map(graph.filter(({ type }) => type === "software_Package").map((node) => [node.spdxId, node]));
  let count = 0;
  for (const item of graph) {
    if (item.comment !== PROFILE) continue;
    require(item.type === "Annotation" && item.annotationType === "other" && item.contentType === "application/json", "SPDX 3 lifecycle annotation has an invalid type or media type");
    const pkg = packages.get(item.subject);
    require(pkg !== undefined, "SPDX 3 lifecycle annotation subject must identify a package");
    const references = list(pkg.externalRef, "SPDX 3 externalRef").flatMap(({ locator }) => Array.isArray(locator) ? locator : []);
    require(typeof item.statement === "string", "SPDX 3 lifecycle annotation statement must be JSON text");
    checkStatement(JSON.parse(item.statement), references);
    count++;
  }
  return count;
}

try {
  require(process.argv.length === 3, "Usage: node check.mjs <sbom.json>");
  const document = JSON.parse(await readFile(process.argv[2], "utf8"));
  require(object(document), "Expected a JSON SBOM object");
  let count;
  if (document.bomFormat === "CycloneDX") count = checkCycloneDx(document);
  else if (document.spdxVersion === "SPDX-2.3") count = checkSpdx2(document);
  else if (document["@context"] === SPDX_3) count = checkSpdx3(document);
  else throw new Error("Expected CycloneDX JSON or SPDX 2.3 / 3.0.1 JSON");
  console.log(`acc-lifecycle-sbom: ${count} lifecycle records conform`);
} catch (error) {
  console.error(`acc-lifecycle-sbom: ${error.message}`);
  process.exitCode = 1;
}
