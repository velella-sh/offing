import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { bundledRules } from "@velella/ebb/bundled-rules";
import { scanManifestFile } from "../src/cache-paths.js";
import { estimateTokens, serialized } from "../src/mcp/limit.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { analyzeSourceUsage } from "../src/source-usage.js";
import { buildStackContext, stackApiContracts, STACK_CONTEXT_TOKEN_LIMIT } from "../src/stack-context.js";
import { readStackContext } from "../src/stack-context-local.js";
import { readRuntimePins } from "../src/upgrade/target-lifecycle.js";

const fixture = async (t: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), "offing-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test("stack reports reviewed evidence and preserves unknown runtime support", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, ".nvmrc"), "18\n");
  await writeFile(join(root, ".tool-versions"), "golang 1.25\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { request: "2.88.2" } }));
  await writeFile(join(root, "index.cjs"), 'const util = require("node:util");\nutil.isArray([]);\n');
  const day = "2026-11-27";
  const scan = await scanWithBuiltIns(root, { noCache: true, scannedAt: `${day}T00:00:00.000Z` });
  const rules = await bundledRules();
  const pins = await readRuntimePins(root);
  const contracts = stackApiContracts(rules, pins, day);
  const usages = await analyzeSourceUsage(root, contracts);
  const ids = new Set(usages.filter(({ usages }) => usages.length > 0).map(({ contractId }) => contractId));
  const report = buildStackContext(scan, rules, pins, ids);
  const node = report.components.find(({ component }) => component === "nodejs");
  assert.equal(node?.inUse, "18");
  assert.equal(node.endOfLife, "2025-04-30");
  assert(node.supportedVersions.some(({ version }) => version === "22"));
  assert.equal(report.components.find(({ component }) => component === "go")?.status, "no-data");
  const entry = report.avoid.find(({ component }) => component === "pkg:npm/request");
  assert.equal(entry?.ruleId, "npm.package.request.deprecated");
  assert(entry.replacement);
  const api = report.avoid.find(({ ruleId }) => ruleId === "nodejs.symbol.util.isarray");
  assert.equal(api?.kind, "api");
  assert.equal(api.replacement, "Array.isArray()");
  assert.deepEqual(buildStackContext(scan, [...rules].reverse(), [...pins].reverse(), ids), report);
  assert.equal(buildStackContext({ ...scan, findings: [] }, [], []).status, "no-data");
});

test("long evidence keeps the most urgent entries within the fixed budget", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { request: "2.88.2" } }));
  const scan = await scanWithBuiltIns(root, { noCache: true });
  const finding = scan.findings.find(({ ruleId }) => ruleId === "npm.package.request.deprecated");
  const rule = (await bundledRules()).find(({ id }) => id === "npm.package.request.deprecated");
  assert(finding && rule);
  const copies = Array.from({ length: 60 }, (_, index) => ({
    id: `npm.package.sample-${index}.deprecated`,
    purl: `pkg:npm/sample-${index}`,
    deadline: index === 42 ? "2025-01-01" : "2026-01-01",
  }));
  const report = buildStackContext(
    { ...scan, findings: copies.map(({ id }) => ({ ...finding, ruleId: id })) },
    copies.map((copy) => ({ ...rule, ...copy })),
    [],
  );
  assert.equal(report.avoid[0]?.ruleId, "npm.package.sample-42.deprecated");
  assert(report.omitted > 0);
  assert.equal(report.avoid.length + report.omitted, copies.length);
  assert(estimateTokens(serialized(report)) <= STACK_CONTEXT_TOKEN_LIMIT);
});

test("current cache input digests invalidate a same-size, same-mtime edit without persisting a scan", async (t) => {
  const root = await fixture(t);
  const cache = join(root, "local-cache");
  const originalDirectory = process.env.OFFING_CACHE_DIR;
  const originalDisabled = process.env.OFFING_NO_CACHE;
  process.env.OFFING_CACHE_DIR = cache;
  process.env.OFFING_NO_CACHE = "0";
  t.after(() => {
    if (originalDirectory === undefined) delete process.env.OFFING_CACHE_DIR;
    else process.env.OFFING_CACHE_DIR = originalDirectory;
    if (originalDisabled === undefined) delete process.env.OFFING_NO_CACHE;
    else process.env.OFFING_NO_CACHE = originalDisabled;
  });
  const pkg = join(root, "package.json");
  assert.equal(await readStackContext(root, "cached"), undefined);
  const manifest = (dependency: string) => JSON.stringify({ dependencies: { [dependency]: "2.88.2" } });
  const stamp = new Date("2026-01-01T00:00:00.000Z");
  await writeFile(pkg, manifest("request"));
  await utimes(pkg, stamp, stamp);
  await scanWithBuiltIns(root, { cacheDirectory: cache });
  const scanManifest = scanManifestFile(cache, root);
  const cachedManifest = await readFile(scanManifest, "utf8");
  const before = await readStackContext(root, "cached");
  assert(before?.avoid.some(({ ruleId }) => ruleId === "npm.package.request.deprecated"));
  await writeFile(pkg, manifest("express"));
  await utimes(pkg, stamp, stamp);
  assert.equal(await readStackContext(root, "cached"), undefined);
  const after = await readStackContext(root);
  assert(!after.avoid.some(({ ruleId }) => ruleId === "npm.package.request.deprecated"));
  assert.equal(await readFile(pkg, "utf8"), manifest("express"));
  assert.equal(await readFile(scanManifest, "utf8"), cachedManifest);
});
