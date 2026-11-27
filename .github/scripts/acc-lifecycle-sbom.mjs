import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binary = resolve(process.argv[2]);
const checker = fileURLToPath(new URL("../../docs/spec/lifecycle-properties/conformance/check.mjs", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "offing-lifecycle-sbom-"));
const creationInfo = {
  type: "CreationInfo",
  created: "2026-01-01T00:00:00Z",
  createdBy: ["urn:example:author"],
  specVersion: "3.0.1",
};
const purl = "pkg:generic/nodejs@20.0.0";
const samples = {
  cyclone: {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [{ type: "application", name: "nodejs", purl }],
  },
  spdx2: {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "Example",
    documentNamespace: "https://example.com/offing/sbom",
    creationInfo: { created: creationInfo.created, creators: ["Organization: Example"] },
    packages: [
      {
        name: "nodejs",
        SPDXID: "SPDXRef-nodejs",
        downloadLocation: "NOASSERTION",
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl }],
      },
    ],
  },
  spdx3: {
    "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
    "@graph": [
      { type: "Organization", spdxId: "urn:example:author", name: "Example", creationInfo },
      { type: "software_Package", spdxId: "urn:example:nodejs", name: "nodejs", software_packageUrl: purl, creationInfo },
    ],
  },
};

function offing(...args) {
  const options = { cwd, encoding: "utf8" };
  if (binary.endsWith(".js")) return execFileSync(process.execPath, [binary, ...args], options);
  return execFileSync(binary, args, options);
}

try {
  for (const [name, input] of Object.entries(samples)) {
    const original = JSON.stringify(input);
    const inputPath = join(cwd, `${name}.json`);
    const enrichedPath = join(cwd, `${name}.enriched.json`);
    writeFileSync(inputPath, original);
    const enriched = offing("sbom", "enrich", inputPath, "--data-version", "bundled");
    assert.equal(readFileSync(inputPath, "utf8"), original);
    writeFileSync(enrichedPath, enriched);
    const result = execFileSync(process.execPath, [checker, enrichedPath], { cwd, encoding: "utf8" });
    assert.match(result, /acc-lifecycle-sbom: [1-9]\d* lifecycle records conform/);
    console.log(`${name}: ${result.trim()}`);
  }
  const cle = offing("export", "--format", "cle", "--data-version", "bundled");
  const documents = cle.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(documents.some(({ identifier, events }) => typeof identifier === "string" && events?.length > 0));
  console.log("acc-lifecycle-sbom: CycloneDX, SPDX 2.3, SPDX 3.0.1 and CLE verified");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
