import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [bin] = process.argv.slice(2);
if (!bin) throw new Error("Usage: node acc-upgrade-blockers.mjs <installed offing bin>");
const root = await mkdtemp(join(tmpdir(), "offing-upgrade-smoke-"));
const args = ["upgrade-check", "--to", "nodejs@22", root, "--graph"];

function cli(...flags) {
  const result = spawnSync(bin, [...args, ...flags], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 1, result.error?.message ?? result.stderr);
  return result.stdout;
}

async function verifyMcp(expected) {
  const server = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: server.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const timer = setTimeout(() => server.kill(), 15_000);
  const send = (method, params, id) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  const receive = async () => {
    const message = await messages.next();
    assert.equal(message.done, false);
    const response = JSON.parse(message.value);
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  };
  try {
    send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "offing-smoke", version: "1" } }, 1);
    assert.ok((await receive()).capabilities.tools);
    send("notifications/initialized");
    send("tools/call", { name: "check_upgrade", arguments: { path: root, target: "nodejs@22" } }, 2);
    const result = await receive();
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, expected);
  } finally {
    clearTimeout(timer);
    lines.close();
    server.stdin.end();
    server.kill();
  }
}

try {
  await copyFile(new URL("../../examples/upgrade/npm-lock/package-lock.json.fixture", import.meta.url), join(root, "package-lock.json"));
  const report = JSON.parse(cli("--json"));
  assert.equal(report.schemaVersion, "offing.upgrade.v1");
  assert.equal(report.verdict, "blocked");
  assert.deepEqual(report.issues[0].chain, ["sharp@0.30.7"]);
  assert.equal(report.graph.roots[0].unlocks, 1);
  assert.equal(report.graph.roots[0].blockers[0].firstSupported, "unknown");
  assert.match(cli("--format", "mermaid"), /^flowchart TD/);
  assert.match(cli("--format", "svg"), /^<svg/);
  assert.match(cli("--format", "svg", "--theme", "dark"), /#151d29/);
  await verifyMcp(report);
  console.log("acc-upgrade-blockers: installed CLI and MCP blocker graphs agree, including Mermaid and both SVG themes");
} finally {
  await rm(root, { recursive: true, force: true });
}
