import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const [command, ...argv] = process.argv.slice(2);
assert(command, "Usage: node check.mjs <implementation command> [arguments]");
const run = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), "offing-what-if-"));
const root = join(workspace, "example");
const env = { ...process.env, OFFING_NO_CACHE: "1", OFFING_DATA_VERSION: "bundled" };
const call = (args) => run(command, [...argv, "forecast", ...args], { cwd: workspace, env, timeout: 15_000 });
const date = "2026-11-27";
const targets = ["nodejs@22", "python@3.13"];
const commit = "a".repeat(40);

async function mcp(arguments_) {
  const child = spawn(command, [...argv, "mcp"], { cwd: workspace, env, stdio: ["pipe", "pipe", "inherit"] });
  const input = createInterface({ input: child.stdout });
  const lines = input[Symbol.asyncIterator]();
  const send = (method, params, id) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const receive = async (id) => {
    for (;;) {
      const { value, done } = await lines.next();
      assert(!done, "MCP closed before its response");
      const message = JSON.parse(value);
      if (message.id !== id) continue;
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      return message.result;
    }
  };
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "what-if-check", version: "1" } }, 1);
    assert((await receive(1)).serverInfo);
    send("notifications/initialized");
    send("tools/call", { name: "simulate_upgrade", arguments: arguments_ }, 2);
    const response = await receive(2);
    assert(!response.isError, JSON.stringify(response));
    return response.structuredContent;
  } finally {
    clearTimeout(timeout);
    input.close();
    child.stdin.end();
    child.kill();
  }
}

const row = (name, verdict) => ({
  name: `example/${name}`, host: "https://example.com", commit, status: "scanned", reason: null,
  ...(verdict ? { whatIfEvidence: { date, targets: [{ runtime: "nodejs", version: "22", verdict, reason: `Fixture ${verdict}.` }] } } : {}),
});
try {
  await mkdir(root);
  const original = "FROM node:18 AS build\nFROM node:18-alpine3.17\nCOPY --from=build /file /file\n";
  await writeFile(join(root, "Dockerfile"), original);
  await writeFile(join(root, ".nvmrc"), "18\n");
  await writeFile(join(root, ".python-version"), "3.9\n");
  const opts = [root, "--target", targets[0], "--target", targets[1], "--as-of", date, "--effort"];
  const value = JSON.parse((await call([...opts, "--json"])).stdout);
  assert.equal(value.schemaVersion, "offing.whatif.v1");
  assert.equal(value.kind, "repository");
  assert.deepEqual(value.reports.map(({ target }) => `${target.runtime}@${target.version}`), targets);
  const [node, python] = value.reports;
  assert.equal(node.support.date, "2027-04-30");
  assert(node.pins.some(({ value, replacement }) => value === "node:18" && replacement === "node:22"));
  assert(node.pins.some(({ value, change }) => value === "node:18-alpine3.17" && change === "unresolved"));
  assert(node.forecast.removed.some(({ path }) => path === ".nvmrc"));
  assert(node.forecast.retained.some(({ path, line }) => path === "Dockerfile" && line === 2));
  assert(python.forecast.removed.some(({ path }) => path === ".python-version"));
  assert(!python.pins.some(({ path }) => path === "Dockerfile"));
  for (const format of ["text", "markdown"]) {
    const { stdout } = await call([...opts, "--format", format]);
    assert(stdout.includes("Forecast through") && stdout.includes("Verdict: unknown"));
  }
  const single = { ...value, reports: [python] };
  assert.deepEqual(await mcp({ repository_path: root, targets: [targets[1]], as_of: date, effort: true }), single);
  const multiple = await mcp({ repository_path: root, targets, as_of: date, effort: true });
  assert.deepEqual(multiple.reports[0].target, node.target);
  assert.deepEqual(multiple.reports[0].support, node.support);
  if (multiple.more === undefined) assert.deepEqual(multiple, value);
  else assert.equal(multiple.more.truncated, true);
  const fleet = join(workspace, "fleet.json");
  await writeFile(fleet, JSON.stringify({
    schemaVersion: "offing.fleet.v1",
    repositoryStatus: [row("ready", "ready"), row("blocked", "blocked"), row("old")],
  }));
  const saved = JSON.parse((await call(["--fleet", fleet, "--target", targets[0], "--json"])).stdout);
  assert.equal(saved.kind, "fleet");
  const [summary] = saved.reports;
  assert.deepEqual([summary.ready[0].name, summary.blocked[0].name, summary.unknown[0].name],
    ["example/ready", "example/blocked", "example/old"]);
  assert.equal(summary.ready[0].commit, commit);
  for (const args of [
    [root, "--target", "nodejs@latest"],
    [root, "--target", "nodejs@22", "--as-of", "2026-02-29"],
    [root, "--target", "nodejs@22", "--svg"],
  ]) {
    await assert.rejects(call(args), (error) => error.code === 2);
  }
  assert.equal(await readFile(join(root, "Dockerfile"), "utf8"), original);
  console.log("acc-what-if: CLI, saved fleet, MCP, and input validation passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
