import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { validateRegistryV2 } from "@velella/ebb/registry";
import { Ajv2020 } from "ajv/dist/2020.js";

import { renderForecastIcs } from "../src/forecast-ics.js";
import { forecastDataRelease, loadForecastData, verifyBundle } from "../src/forecast-tool/data.js";
import type { ForecastData } from "../src/forecast-tool/data.js";
import { contractVersion, inputs, maxInputBytes, name, recordsSchema, run } from "../src/forecast-tool.js";
import { runForecastTool, toForecastRecords } from "../src/forecast-tool/records.js";
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

async function localRelease() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const actionMap = "registry/github-actions-shas.json";
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      manifest: { version: forecastDataRelease.version },
      files: {
        ...Object.fromEntries(installed),
        [actionMap]: await readJson(`node_modules/@velella/ebb/${actionMap}`),
      },
    }),
  );
  const key = await crypto.subtle.exportKey("spki", publicKey);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes);
  const release = {
    ...forecastDataRelease,
    publicKey: Buffer.from(key).toString("base64"),
    signature: Buffer.from(signature).toString("base64"),
  };
  return { bytes, release };
}

test("acc-forecast-island reads one relative signed data asset and checks trust and version", async () => {
  const { bytes, release } = await localRelease();
  const reads: string[] = [];
  const padded = new Uint8Array(bytes.length + 6);
  padded.set(bytes, 3);
  const read = async (file: string) => {
    reads.push(file);
    return padded.subarray(3, -3);
  };
  const loaded = await loadForecastData(read, release);
  assert.equal(loaded.version, release.version);
  assert.deepEqual(reads, [release.file]);
  for (const file of ["../ebb.json", "/ebb.json", "https://example.invalid/ebb.json"]) {
    await assert.rejects(loadForecastData(read, { ...release, file }), /relative Ebb data filename/);
  }
  assert.deepEqual(reads, [release.file]);
  await assert.rejects(loadForecastData(read, { ...release, version: "other-version" }), /does not match the release/);
  const corrupted = Uint8Array.from(bytes);
  corrupted[0] = 0;
  await assert.rejects(
    loadForecastData(async () => corrupted, release),
    /signature could not be verified/,
  );
});

test("acc-forecast-island file and paste use only host data and return matching calendar records", async (t) => {
  assert.equal(contractVersion, 1);
  assert.equal(name, "offing-forecast");
  assert.equal(recordsSchema, "https://velella.sh/offing/schemas/forecast-records.v1.schema.json");
  assert.deepEqual(inputs, ["file", "paste", "url"]);
  const privateText = '{"dependencies":{"next":"15.0.0"},"private-note":"no-upload-at-all"}';
  const { bytes, release } = await localRelease();
  const reads: string[] = [];
  const refuse = () => {
    throw new Error("Forecast attempted a direct fetch");
  };
  const globalFetch = t.mock.method(globalThis, "fetch", refuse);
  const hostFetch = t.mock.fn(refuse);
  const context = {
    signal: new AbortController().signal,
    data: async (file: string) => {
      reads.push(file);
      return bytes;
    },
    publicRepositoryFetch: hostFetch,
  };
  const file = await runForecastTool(
    {
      kind: "file",
      name: "package.json",
      type: "application/json",
      bytes: new TextEncoder().encode(privateText),
    },
    context,
    release,
    today,
  );
  const paste = await runForecastTool({ kind: "paste", text: privateText }, context, release, today);
  for (const result of [file, paste]) {
    assert.equal(result.status, "ok");
    assert.ok(matchesSchema({ schemaVersion: "offing.forecast-records.v1", records: result.records }));
    const calendar = result.records.find((entry) => entry.kind === "downloadable-file");
    assert.ok(calendar?.kind === "downloadable-file");
    assert.equal(calendar.name, "offing-forecast.ics");
    assert.equal(calendar.mediaType, "text/calendar;charset=utf-8");
    assert.match(calendar.content, /BEGIN:VCALENDAR[\s\S]*DTSTART;VALUE=DATE:20261021/);
    const browserReport = createReport(privateText, data, today, result === file ? "package.json" : undefined);
    assert.equal(calendar.content, renderForecastIcs(browserReport.forecast, browserReport.replacements));
  }
  assert.deepEqual(file.records[0], paste.records[0]);
  assert.deepEqual(
    file.records.find(({ kind }) => kind === "file-read"),
    {
      kind: "file-read",
      input: "file",
      path: "package.json",
    },
  );
  assert.deepEqual(
    paste.records.find(({ kind }) => kind === "file-read"),
    { kind: "file-read", input: "paste" },
  );
  assert.deepEqual(reads, [release.file, release.file]);
  assert.equal(globalFetch.mock.callCount(), 0);
  assert.equal(hostFetch.mock.callCount(), 0);
});

test("acc-forecast-island rejects invalid input before requesting data and preserves aborts", async () => {
  const { bytes, release } = await localRelease();
  const controller = new AbortController();
  const stop = new DOMException("Cancelled by test host", "AbortError");
  let reads = 0;
  const context = {
    signal: controller.signal,
    data: async () => {
      reads++;
      return bytes;
    },
  };
  for (const input of [
    { kind: "file", name: "", type: "", bytes: new Uint8Array() },
    { kind: "file", name: "package.json", type: "application/json", bytes: new Uint8Array(maxInputBytes + 1) },
    { kind: "paste", text: "日".repeat(2 * 1024 * 1024) },
    { kind: "paste", text: "  " },
  ] as const) {
    assert.equal((await runForecastTool(input, context, release, today)).status, "error");
  }
  assert.equal((await run({ kind: "url", value: "github/example/project" }, context)).status, "error");
  assert.equal(reads, 0);
  const empty = await runForecastTool({ kind: "paste", text: "{}" }, context, release, today);
  assert.equal(empty.status, "no-data");
  assert.equal(reads, 1);
  await assert.rejects(
    runForecastTool(
      { kind: "paste", text: "{}" },
      {
        ...context,
        data: async () => {
          controller.abort(stop);
          return bytes;
        },
      },
      release,
      today,
    ),
    (error: unknown) => error === stop,
  );
  await assert.rejects(run({ kind: "paste", text: "{}" }, context), (error: unknown) => error === stop);
  assert.equal(reads, 1);
});

test("acc-forecast-island runs a public repository forecast only with the approved host fetch", async (t) => {
  const { bytes, release } = await localRelease();
  const text = '{\n  "dependencies": {\n    "next": "15.0.0"\n  }\n}';
  const size = Buffer.byteLength(text);
  const sha = createHash("sha1").update(`blob ${size}\0`).update(text).digest("hex");
  const paths = ["package.json", "web/package.json"];
  const treeUrl = "https://api.github.com/repos/example/project/git/trees/HEAD?recursive=1";
  const rawUrl = "https://raw.githubusercontent.com/example/project/HEAD/";
  const fetchMock = t.mock.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    if (url === treeUrl) {
      return Response.json({
        truncated: false,
        tree: paths.map((path) => ({ type: "blob", mode: "100644", path, size, sha })),
      });
    }
    assert.ok(paths.some((path) => url === rawUrl + path));
    return new Response(text);
  });
  const read = t.mock.fn(async (name: string) => {
    assert.equal(name, release.file);
    return bytes;
  });
  const input = { kind: "url", value: "github/example/project" } as const;
  const context = { signal: new AbortController().signal, data: read, fetch: fetchMock };
  const denied = await runForecastTool(input, context, release, today);
  assert.deepEqual(denied, {
    status: "error",
    message: "Approve access to GitHub before running a repository forecast.",
    records: [],
  });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);

  const approved = { ...context, publicRepositoryFetch: fetchMock };
  const result = await runForecastTool(input, approved, release, today);
  assert.equal(result.status, "ok", result.message);
  assert.deepEqual(
    fetchMock.mock.calls.map(({ arguments: [url] }) => url),
    [treeUrl, ...paths.map((path) => rawUrl + path)],
  );
  assert.equal(read.mock.callCount(), 1);
  assert.ok(matchesSchema({ schemaVersion: "offing.forecast-records.v1", records: result.records }));
  assert.equal(result.records[0]?.checked, 2);
  assert.deepEqual(
    result.records.filter((entry) => entry.kind === "file-read"),
    paths.map((path) => ({ kind: "file-read", input: "file", path })),
  );
  const finding = result.records.find((entry) => entry.kind === "finding");
  assert.ok(finding?.kind === "finding");
  assert.deepEqual(
    finding.findings.map(({ path, line }) => ({ path, line })),
    paths.map((path) => ({ path, line: 3 })),
  );
  assert.equal(result.records.filter((entry) => entry.kind === "downloadable-file").length, 1);

  const empty = await runForecastTool(
    input,
    { ...context, publicRepositoryFetch: async () => Response.json({ truncated: false, tree: [] }) },
    release,
    today,
  );
  assert.deepEqual(empty, { status: "no-data", message: "No supported repository files found.", records: [] });
  assert.equal(read.mock.callCount(), 1);
  const oversized = await runForecastTool({ ...input, value: "x".repeat(8193) }, approved, release, today);
  assert.match(oversized.message, /selector is too long/);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("acc-forecast-island bounds the number of declarations before generating records", async () => {
  const { bytes, release } = await localRelease();
  const dependencies = Object.fromEntries(
    Array.from({ length: 10_001 }, (_, index) => [`forecast-bound-${index}`, "1.0.0"]),
  );
  const result = await runForecastTool(
    { kind: "paste", text: JSON.stringify({ dependencies }) },
    { signal: new AbortController().signal, data: async () => bytes },
    release,
    today,
  );
  assert.deepEqual(result, {
    status: "error",
    message: "The input contains too many declarations for the forecast.",
    records: [],
  });
});
