import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { validateRegistryV2 } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";

import { renderForecastIcs } from "../src/forecast-ics.js";
import { verifyBundle } from "../src/forecast-tool/data.js";
import type { ForecastData } from "../src/forecast-tool/data.js";
import { toForecastRecords } from "../src/forecast-tool/records.js";
import { createReport } from "../src/forecast-tool/report.js";

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const [schema, installed] = await Promise.all([
  readJson("schemas/forecast-records.v1.schema.json"),
  Promise.all(
    ["npm", "nodejs", "python", "github-actions", "dotnet"].map(async (name) => {
      const file = `registry/${name}.json`;
      return [file, await readJson(`node_modules/@velella/ebb/${file}`)] as const;
    }),
  ),
]);
assert.ok(typeof schema === "object" && schema !== null);
const matchesSchema = new Ajv2020({ strictTuples: false }).compile(schema);
const data: ForecastData = {
  version: "bundled",
  rules: installed.flatMap(([, registry]) => validateRegistryV2(registry).rules),
  actionVersions: new Map(),
};
const today = "2026-09-01";

test("reads authenticated Ebb registries and rejects an invalid signed Actions version map", async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64");
  const algorithm = { name: "ECDSA", hash: "SHA-256" };
  const file = "registry/github-actions-shas.json";
  async function check(files: Record<string, unknown>) {
    const bytes = new TextEncoder().encode(JSON.stringify({ manifest: { version: "2026.11.11" }, files })).buffer;
    const signature = Buffer.from(await crypto.subtle.sign(algorithm, privateKey, bytes)).toString("base64");
    return verifyBundle(bytes, { publicKey: spki, signature });
  }
  const release = { ...Object.fromEntries(installed), [file]: await readJson(`node_modules/@velella/ebb/${file}`) };
  const loaded = await check(release);
  assert.equal(loaded.version, "2026.11.11");
  assert.deepEqual(loaded.rules, data.rules);
  assert.ok(loaded.actionVersions.get("actions/checkout")?.size);
  await assert.rejects(
    check({ ...release, [file]: { actions: { "actions/checkout": { sha: null } } } }),
    /invalid GitHub Actions version/,
  );
});

test("projects browser file and paste fixtures into the same dated buckets, data gaps and calendar", async () => {
  const cases = [
    ["tests/fixtures/forecast-web/package-lock-v2.json", "package-lock.json"],
    ["tests/fixtures/forecast-web/pyproject.toml.fixture", "pyproject.toml"],
    ["tests/fixtures/forecast-web/requirements.txt.fixture", "requirements.txt"],
    ["examples/workflows/forecast.yml", "forecast.yml"],
  ] as const;
  for (const [file, path] of cases) {
    const input = await readFile(file, "utf8");
    const fileReport = createReport(input, data, today, path);
    const pasteReport = createReport(input, data, today);
    const result = toForecastRecords(fileReport, data.version);
    const pasted = toForecastRecords(pasteReport, data.version);
    assert.ok(matchesSchema(result), JSON.stringify(matchesSchema.errors));
    assert.ok(matchesSchema(pasted), JSON.stringify(matchesSchema.errors));
    const summary = result.records[0];
    assert.deepEqual(summary, pasted.records[0], path);
    assert.equal(summary.checked, fileReport.checked);
    assert.deepEqual(
      result.records
        .filter((entry) => entry.kind === "time-bucket")
        .map(({ until, total, affecting }) => ({ until, total, affecting })),
      fileReport.forecast.buckets.map(({ until, total, affecting }) => ({ until, total, affecting })),
    );
    assert.deepEqual(
      result.records.find(({ kind }) => kind === "file-read"),
      { kind: "file-read", input: "file", path },
    );
    assert.deepEqual(
      pasted.records.find(({ kind }) => kind === "file-read"),
      { kind: "file-read", input: "paste" },
    );
    assert.equal(
      result.records.find((entry) => entry.kind === "downloadable-file")?.content,
      renderForecastIcs(fileReport.forecast, fileReport.replacements),
    );
    assert.deepEqual(toForecastRecords(fileReport, data.version), result, path);
  }
});

test("keeps rule sources and no-data evidence distinct and rejects malformed records", () => {
  const input = '{"dependencies":{"next":"15.0.0","offing-forecast-test-unknown":"1.0.0"}}';
  const result = toForecastRecords(createReport(input, data, today, "package.json"), data.version);
  assert.ok(matchesSchema(result), JSON.stringify(matchesSchema.errors));
  assert.equal(result.records[0].weather, "storm");
  const finding = result.records.find((entry) => entry.kind === "finding");
  assert.equal(finding?.source, "https://nextjs.org/support-policy");
  assert.equal(finding.findings[0]?.path, "package.json");
  assert.ok(
    result.records.some(
      (entry) =>
        entry.kind === "notice" &&
        entry.code === "no-data" &&
        entry.component === "pkg:npm/offing-forecast-test-unknown",
    ),
  );
  const withoutDownload = result.records.filter(({ kind }) => kind !== "downloadable-file");
  assert.equal(matchesSchema({ ...result, records: withoutDownload }), false);
  const sourceReplaced = result.records.map((record) =>
    record.kind === "finding" ? { ...record, source: "javascript:alert(1)" } : record,
  );
  assert.equal(matchesSchema({ ...result, records: sourceReplaced }), false);
  const unnamed = result.records.map((record) =>
    record.kind === "file-read" ? { kind: "file-read", input: "file" } : record,
  );
  assert.equal(matchesSchema({ ...result, records: unnamed }), false);
});

test("reports an empty manifest separately from an unclassified reference", () => {
  const result = toForecastRecords(createReport("{}", data, today), data.version);
  assert.ok(matchesSchema(result), JSON.stringify(matchesSchema.errors));
  assert.deepEqual(
    result.records.filter(({ kind }) => kind === "notice"),
    [{ kind: "notice", code: "no-supported-declarations" }],
  );
  assert.equal(result.records[0].checked, 0);
  assert.equal(result.records[0].weather, "clear");
});
