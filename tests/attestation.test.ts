import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { type ActiveData, getActiveData } from "@velella/ebb/data-source";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isIsoDate } from "@velella/ebb/registry";

import { checkAttestation } from "../src/attestation/check.js";
import { ebbSnapshot, PREDICATE_TYPE, type LifecycleStatement } from "../src/attestation/statement.js";
import { VERSION } from "../src/version.js";
import { runCli } from "./cli-runner.js";

const root = await mkdtemp(join(tmpdir(), "offing-attestation-test-"));
after(() => rm(root, { force: true, recursive: true }));

const subjectFile = join(root, "artifact.bin");
const body = "attestation artifact bytes\n";
const sha256 = createHash("sha256").update(body).digest("hex");
const digestSubject = `sha256:${sha256}`;
const today = new Date().toISOString().slice(0, 10);
await writeFile(subjectFile, body);

const checker = resolve("docs/spec/lifecycle-attestation/conformance/check.mjs");
const verifier = resolve("docs/spec/lifecycle-attestation/example/verify.mjs");
const testSbom = resolve("tests/fixtures/attestation/bom.cdx.json");
const payloadType = "application/vnd.in-toto+json";
const mediaType = "application/vnd.dev.sigstore.bundle.v0.3+json";
const suite = JSON.parse(
  await readFile(resolve("docs/spec/lifecycle-attestation/conformance/fixtures.json"), "utf8"),
) as {
  statement: LifecycleStatement;
  cases: Array<{
    name: string;
    valid: boolean;
    expectedDaysLeft?: number;
    replacements: Array<{ path: Array<string | number>; value?: unknown }>;
  }>;
};

async function statementFile(name: string, value: unknown): Promise<string> {
  const file = join(root, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

test("attest records exact artifact bytes, the bundled Ebb content address and repository scan observations", async () => {
  await writeFile(join(root, "package.json"), '{"dependencies":{"request":"2.88.2"}}');
  const result = await runCli(["attest", root, "--subject", subjectFile, "--data-version", "bundled"]);
  assert.equal(result.code, 0, result.stderr);
  const value = JSON.parse(result.stdout) as LifecycleStatement;
  assert.equal(value.predicateType, PREDICATE_TYPE);
  assert.deepEqual(value.subject, [{ name: "artifact.bin", digest: { sha256 } }]);
  assert.equal(value.predicate.offingVersion, VERSION);
  assert.equal(value.predicate.builtOn, today);
  assert.deepEqual(value.predicate.ebb, ebbSnapshot(await getActiveData()));
  assert.match(value.predicate.ebb.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(value.predicate.ebb.signature, undefined);
  assert.equal(value.predicate.input, "scan");
  assert.ok(value.predicate.components.some((component) => component.purl === "pkg:npm/request"));
  const file = await statementFile("scan.json", value);
  const checked = await runCli(["attest", "check", file, "--subject", digestSubject, "--today", today]);
  assert.equal(checked.code, 0, checked.stderr);
  assert.match(checked.stdout, /request.*affected/);
  assert.match(checked.stdout, /Cryptographic verification requires an external verifier/);
});

test("attest accepts CycloneDX, SPDX 2.3 and Syft JSON SBOMs, including unknown components", async () => {
  const spdx = await statementFile("fixture.spdx.json", {
    spdxVersion: "SPDX-2.3",
    packages: [
      {
        name: "request",
        versionInfo: "2.88.2",
        externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/request" }],
      },
      { name: "unidentified" },
    ],
  });
  const syft = await statementFile("fixture.syft.json", {
    descriptor: { name: "syft" },
    artifacts: [{ name: "request", version: "2.88.2", purl: "pkg:npm/request" }, { name: "unidentified" }],
  });
  for (const sbom of [testSbom, spdx, syft]) {
    const result = await runCli(["attest", "--subject", digestSubject, "--sbom", sbom, "--data-version=bundled"]);
    assert.equal(result.code, 0, result.stderr);
    const value = JSON.parse(result.stdout) as LifecycleStatement;
    assert.deepEqual(value.subject, [{ digest: { sha256 } }]);
    assert.equal(value.predicate.input, "sbom");
    assert.ok(
      value.predicate.components.some((entry) => entry.purl === "pkg:npm/request" && entry.version === "2.88.2"),
    );
    assert.ok(value.predicate.noData.some((entry) => entry.name));
    assert.ok((await checkAttestation(await statementFile("sbom.json", value), today)).components.length >= 2);
    if (sbom === testSbom) {
      assert.ok(value.predicate.noData.some((entry) => entry.purl === "pkg:npm/offing-test-unknown-component"));
    }
  }
});

test("cached Ebb signatures keep signer identity and a verifiable published tag reference", () => {
  const fakeData = (identity: string): ActiveData => ({
    info: {
      source: "pinned",
      version: "2026.05.01",
      contentDigest: digestSubject,
      signer: { identity, issuer: "https://token.actions.githubusercontent.com" },
      createdAt: "2026-05-01T00:00:00Z",
      reviewedThrough: "2026-05-01",
      warnings: [],
    },
    read: () => Promise.reject(new Error("unexpected read")),
    readSync: () => {
      throw new Error("unexpected read");
    },
  });
  const base = "https://github.com/velella-sh/ebb/.github/workflows/data-release.yml@refs/";
  const tagged = ebbSnapshot(fakeData(base + "tags/data-v2026.05.01"));
  assert.equal(tagged.digest, digestSubject);
  assert.equal(
    tagged.signature?.bundleUrl,
    "https://github.com/velella-sh/ebb/releases/download/data-v2026.05.01/ebb-data-2026.05.01.json.sigstore.json",
  );
  const manual = ebbSnapshot(fakeData(base + "heads/main"));
  assert.equal(manual.signature?.identity, base + "heads/main");
  assert.equal(manual.signature?.bundleUrl, tagged.signature?.bundleUrl);
  assert.equal(ebbSnapshot(fakeData("https://example.com/nonstandard")).signature?.bundleUrl, undefined);
});

test("CLI and published schema enforce the shared structural and semantic vectors", async () => {
  const schema: object = JSON.parse(await readFile(resolve("schemas/lifecycle-attestation.v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ strictRequired: false })
    .addFormat("uri", URL.canParse)
    .addFormat("date", isIsoDate)
    .compile(schema);
  for (const vector of suite.cases) {
    const value = structuredClone(suite.statement);
    for (const { path, value: replacement } of vector.replacements) {
      const pointer = path.slice(0, -1).reduce<unknown>((object, key) => Reflect.get(object as object, key), value);
      const field = path.at(-1);
      assert.notEqual(field, undefined);
      if (replacement === undefined) Reflect.deleteProperty(pointer as object, String(field));
      else Reflect.set(pointer as object, String(field), replacement);
    }
    const result = await runCli([
      "attest",
      "check",
      await statementFile("vector.json", value),
      "--today",
      "2024-03-01",
    ]);
    assert.equal(result.code, vector.valid ? 0 : 4, `${vector.name}: ${result.stderr}`);
    const onlySemantic = ["inconsistent build-time day count", "duplicated component rule"].includes(vector.name);
    assert.equal(validate(value), vector.valid || onlySemantic, `${vector.name}: ${JSON.stringify(validate.errors)}`);
    if (vector.expectedDaysLeft !== undefined) assert.match(result.stdout, /-1 days left/);
  }
  const conformance = execFileSync(process.execPath, [checker, "--suite", process.execPath, verifier], {
    encoding: "utf8",
    cwd: root,
  });
  assert.match(conformance, /12 fixtures passed with the reference verifier/);
});

test("attest check accepts Sigstore DSSE payloads but detects malformed or tampered inputs", async () => {
  const payload = Buffer.from(JSON.stringify(suite.statement)).toString("base64");
  const bundle = { mediaType, dsseEnvelope: { payloadType, payload } };
  const bundleFile = await statementFile("bundle.json", bundle);
  const expected = suite.statement.subject[0]?.digest.sha256;
  const check = await checkAttestation(bundleFile, "2024-03-01", `sha256:${expected}`);
  assert.equal(check.envelope, "sigstore-bundle");
  assert.equal(check.components[0]?.rules[0]?.daysLeft, -1);
  assert.equal(check.components.at(-1)?.status, "no-data");

  const badInputs = [
    ["bundle.json", ["--subject", subjectFile], /digest does not match/],
    ["bundle.json", ["--today", "2024-03-32"], /UTC calendar date/],
    ["not-present.json", [], /Cannot read attestation/],
    [".", [], /regular file/],
  ] as const;
  for (const [file, args, error] of badInputs) {
    const result = await runCli(["attest", "check", join(root, file), ...args]);
    assert.equal(result.code, 4, result.stderr);
    assert.match(result.stderr, error);
  }
  const malformed = [
    [{ ...bundle, mediaType: "unrecognized" }, /Unsupported Sigstore bundle/],
    [{ ...bundle, dsseEnvelope: { ...bundle.dsseEnvelope, payloadType: "text/plain" } }, /in-toto JSON payload/],
    [{ ...bundle, dsseEnvelope: { payloadType, payload: payload + "=" } }, /canonical padded base64/],
    [{ ...bundle, dsseEnvelope: { payloadType, payload: "/w==" } }, /valid UTF-8/],
    [{ ...bundle, dsseEnvelope: { payloadType, payload: "ew==" } }, /strict JSON/],
  ] as const;
  for (const [value, error] of malformed) {
    const result = await runCli(["attest", "check", await statementFile("bad.json", value)]);
    assert.equal(result.code, 4, result.stderr);
    assert.match(result.stderr, error);
  }
  const tooLarge = await statementFile("oversized.json", {});
  await truncate(tooLarge, 64 * 1024 * 1024 + 1);
  assert.match((await runCli(["attest", "check", tooLarge])).stderr, /64 MiB input limit/);
});

test("attest command rejects usage and unhashable subjects before writing stdout", async () => {
  for (const args of [
    [],
    ["--sbom"],
    ["--subject="],
    ["--subject", digestSubject, ".", "."],
    ["check"],
    ["check", "--bogus"],
  ]) {
    const result = await runCli(["attest", ...args]);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, "");
  }
  for (const subject of ["sha256:bad", root, join(root, "absent.bin")]) {
    const result = await runCli(["attest", "--subject", subject, "--data-version", "bundled"]);
    assert.equal(result.code, 4, result.stderr);
    assert.equal(result.stdout, "");
  }
});
