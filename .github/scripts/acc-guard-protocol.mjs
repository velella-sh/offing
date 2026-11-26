import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [bin] = process.argv.slice(2);
if (!bin) throw new Error("Usage: node acc-guard-protocol.mjs <installed offing bin>");
const fixtures = JSON.parse(
  readFileSync(new URL("../../docs/spec/agent-guard/conformance/fixtures.json", import.meta.url), "utf8"),
);

const server = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: server.stdout });
const messages = lines[Symbol.asyncIterator]();
const timeout = setTimeout(() => server.kill(), 15_000);

function send(method, params, id) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
}

async function receive(id) {
  while (true) {
    const message = await messages.next();
    if (message.done) throw new Error(`MCP server stopped before reply ${id}`);
    const reply = JSON.parse(message.value);
    if (reply.id === id) {
      if (reply.error) throw new Error(`MCP reply ${id}: ${reply.error.message}`);
      return reply.result;
    }
  }
}

function checkResult({ id, expected }, result) {
  if (expected === null) {
    assert.equal(result.isError, true, id);
    assert.equal(result.structuredContent, undefined, id);
    return;
  }
  assert.equal(result.isError, undefined, id);
  const response = result.structuredContent;
  assert.equal(response.schemaVersion, "offing.agent-guard.response.v1", id);
  assert.ok(response.reason.trim(), id);
  assert.deepEqual(JSON.parse(result.content[0].text), response, id);
  for (const [field, value] of Object.entries(expected)) assert.equal(response[field], value, `${id} ${field}`);
}

try {
  send("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "offing-package-smoke", version: "1.0.0" },
  }, 1);
  assert.ok((await receive(1)).capabilities.tools, "installed MCP server advertises tools");
  send("notifications/initialized");
  for (const [index, fixture] of fixtures.entries()) {
    const id = index + 2;
    send("tools/call", { name: "agent_guard", arguments: fixture.request }, id);
    checkResult(fixture, await receive(id));
  }
  console.log(`acc-guard-protocol: installed MCP server passed ${fixtures.length} cases`);
} finally {
  clearTimeout(timeout);
  lines.close();
  server.stdin.end();
  server.kill();
}
