import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const [bin, pkg] = process.argv.slice(2);
assert(bin && pkg, "Usage: node acc-campaigns.mjs <installed offing bin> <package directory>");
const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "offing-campaign-smoke-"));
const vectors = join(pkg, "docs/spec/campaign/conformance");
const statePath = join(root, "state.json");
const campaign = join(vectors, "valid-campaign.json");
const cli = (...args) => run(bin, args, { cwd: root, timeout: 15_000 });

async function verifyMcp(state) {
  const server = spawn(bin, ["mcp"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: server.stdout });
  const messages = lines[Symbol.asyncIterator]();
  const timer = setTimeout(() => server.kill(), 15_000);
  const send = (method, params, id) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  const receive = async (id) => {
    const message = await messages.next();
    assert.equal(message.done, false);
    const response = JSON.parse(message.value);
    assert.equal(response.id, id);
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  };
  try {
    send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "campaign-smoke", version: "1" } }, 1);
    assert.ok((await receive(1)).capabilities.tools);
    send("notifications/initialized");
    send("tools/list", {}, 2);
    assert.ok((await receive(2)).tools.some((tool) => tool.name === "campaign_status"));
    send("tools/call", { name: "campaign_status", arguments: { state_path: statePath } }, 3);
    const result = await receive(3);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(result.structuredContent, state);
  } finally {
    clearTimeout(timer);
    lines.close();
    server.stdin.end();
    server.kill();
  }
}

try {
  const expected = JSON.parse(await readFile(join(vectors, "valid-state.json"), "utf8"));
  const { stdout } = await cli("campaign", "plan", campaign, "--fleet", join(vectors, "fleet.json"), "--json");
  assert.deepEqual(JSON.parse(stdout), expected);
  await writeFile(statePath, stdout);
  const checked = await cli("campaign", "status", statePath, "--json");
  assert.deepEqual(JSON.parse(checked.stdout), expected);
  const conform = (config, state) => run(process.execPath, [
    join(vectors, "check.mjs"), config, state, join(pkg, "schemas"),
  ], { cwd: root, timeout: 15_000 });
  await conform(campaign, statePath);
  await assert.rejects(conform(join(vectors, "invalid-campaign.json"), statePath));
  await assert.rejects(conform(campaign, join(vectors, "invalid-state.json")));
  await verifyMcp(expected);
  console.log("acc-campaigns: the installed CLI, MCP server and standalone checker agree");
} finally {
  await rm(root, { recursive: true, force: true });
}
