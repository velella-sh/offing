import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { RegistryV2Rule } from "@velella/ebb/registry";
import { enrichSpdx3 } from "../src/sbom/spdx3.js";
import { runCli } from "./cli-runner.js";

const context = "https://spdx.org/rdf/3.0.1/spdx-context.jsonld";
const creator = "urn:example:bom:author";
const subject = "urn:example:bom:node";
const evidence = "https://example.com/node-eol";
const creationInfo = {
  type: "CreationInfo",
  created: "2026-01-01T00:00:00Z",
  createdBy: [creator],
  specVersion: "3.0.1",
};
const pkg = {
  type: "software_Package",
  spdxId: subject,
  name: "nodejs",
  software_packageUrl: "pkg:generic/nodejs",
  software_packageVersion: "20.0.0",
  creationInfo,
  externalRef: [{ type: "ExternalRef", externalRefType: "releaseNotes", locator: ["https://example.com/releases"] }],
};
const input = {
  "@context": context,
  "@graph": [
    { type: "Organization", spdxId: creator, name: "Example", creationInfo },
    { type: "SpdxDocument", spdxId: "urn:example:bom", name: "Example", creationInfo, element: [creator, subject] },
    pkg,
  ],
};
const rule: RegistryV2Rule = {
  id: "example.eol",
  ecosystem: "nodejs",
  purl: "pkg:generic/nodejs",
  vers: "vers:semver/<21.0.0",
  event: "end-of-life",
  title: "Example EOL",
  summary: "No longer supported",
  severity: "high",
  deadline: "2026-01-01",
  replacement: "Node.js 22",
  sources: [{ title: "Policy", url: evidence, accessedAt: "2025-12-01" }],
  provenance: { observedAt: "2025-12-01", reviewedAt: "2026-02-01", reviewer: "test" },
};

const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(JSON.parse(await readFile("schemas/vendor/spdx-3.0.1-json-schema.json", "utf8")));
const checker = resolve("docs/spec/lifecycle-properties/conformance/check.mjs");

test("SPDX 3 enrichment preserves input and adds schema-valid annotations, source links, and document membership", () => {
  const original = structuredClone(input);
  const result = enrichSpdx3(input, [rule]);
  assert.ok(validate(input), JSON.stringify(validate.errors));
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.deepEqual(input, original);
  const graph = result["@graph"] as Array<Record<string, unknown>>;
  const annotation = graph.find(({ type }) => type === "Annotation");
  assert.equal(annotation?.subject, subject);
  assert.equal(annotation?.annotationType, "other");
  assert.deepEqual(JSON.parse(String(annotation?.statement)), {
    ruleId: rule.id,
    milestone: "endOfLife",
    date: rule.deadline,
    sources: [evidence],
    replacement: rule.replacement,
  });
  assert.deepEqual(graph[2]?.externalRef, [
    ...pkg.externalRef,
    { type: "ExternalRef", externalRefType: "documentation", locator: [evidence], comment: "Policy" },
  ]);
  assert.ok(Array.isArray(graph[1]?.element) && graph[1]?.element.includes(annotation?.spdxId));
  assert.deepEqual(enrichSpdx3(result, [rule]), result);
});

test("SPDX 3 accepts a compact single package, or leaves an unmatched package unchanged", () => {
  const single = { "@context": context, ...pkg };
  const result = enrichSpdx3(single, [rule]);
  assert.ok(validate(result), JSON.stringify(validate.errors));
  assert.ok(Array.isArray(result["@graph"]));
  const unmatched = { ...single, software_packageUrl: "pkg:generic/nodejs@22.0.0" };
  assert.deepEqual(enrichSpdx3(unmatched, [rule]), unmatched);
  assert.throws(() => enrichSpdx3({ "@context": context, "@graph": null }, [rule]), /@graph/);
  assert.throws(() => enrichSpdx3({ ...single, spdxId: "relative" }, [rule]), /absolute spdxId/);
  assert.throws(() => enrichSpdx3({ ...single, software_packageVersion: 1 }, [rule]), /packageVersion/);
  assert.throws(() => enrichSpdx3({ ...single, software_packageUrl: "invalid" }, [rule]), /Cannot match/);
  assert.throws(() => enrichSpdx3({ ...single, externalRef: null }, [rule]), /externalRef/);
});

test("CLI enriches SPDX 3, and an independent checker rejects a missing source link", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-spdx3-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "sbom.json");
  const original = JSON.stringify(input);
  await writeFile(path, original);
  const response = await runCli(["sbom", "enrich", path, "--data-version", "bundled"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(await readFile(path, "utf8"), original);
  const enriched = JSON.parse(response.stdout) as { "@graph": Array<Record<string, unknown>> };
  assert.ok(validate(enriched), JSON.stringify(validate.errors));
  const enrichedPath = join(directory, "enriched.json");
  await writeFile(enrichedPath, response.stdout);
  const run = () => spawnSync(process.execPath, [checker, enrichedPath], { cwd: directory, encoding: "utf8" });
  const checked = run();
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /acc-lifecycle-sbom: [1-9]\d* lifecycle records conform/);
  const component = enriched["@graph"][2];
  assert.ok(component);
  delete component.externalRef;
  await writeFile(enrichedPath, JSON.stringify(enriched));
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /missing an HTTPS evidence reference/);
});
