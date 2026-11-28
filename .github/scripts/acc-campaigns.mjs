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

async function verifyOwnerPriority() {
  const config = JSON.parse(await readFile(campaign, "utf8"));
  const fleetPath = join(root, "owner-priority-fleet.json");
  const configPath = join(root, "owner-priority-campaign.json");
  const ruleId = "nodejs.runtime.eol-18";
  function repository(name, deadline, owners) {
    return {
      host: "https://github.com",
      name: `example/${name}`,
      commit: "b".repeat(40),
      status: "scanned",
      forecastEvidence: { findings: [{ ruleId, deadline, owners }] },
    };
  }
  await writeFile(configPath, JSON.stringify({
    ...config,
    select: { ruleId },
    batching: { ...config.batching, size: 2, concurrency: 1 },
  }));
  await writeFile(fleetPath, JSON.stringify({
    schemaVersion: "offing.fleet.v1",
    forecastAsOf: config.asOf,
    repositoryStatus: [
      repository("unowned", null, []),
      repository("third", "2025-05-01", ["@example/later"]),
      repository("second", "2025-04-30", ["@example/earlier"]),
      repository("first", "2025-05-30", ["@example/earlier"]),
    ],
  }));
  const { stdout } = await cli("campaign", "plan", configPath, "--fleet", fleetPath, "--json");
  const state = JSON.parse(stdout);
  assert.deepEqual(state.repositories.map(({ name, batch }) => [name, batch]), [
    ["example/first", 1], ["example/second", 1], ["example/third", 2], ["example/unowned", 2],
  ]);
  return state;
}

async function verifyFailureGate(state) {
  const file = join(root, "limited-state.json");
  const inputs = join(root, "empty-inputs.json");
  await writeFile(file, JSON.stringify(state));
  await writeFile(inputs, "[]");
  const { stdout, stderr } = await cli("campaign", "run", file, "--inputs", inputs, "--json");
  assert.match(stderr, /Batch 1 paused: 2\/2 failed/);
  const stopped = JSON.parse(stdout);
  assert.equal(stopped.rollout.state, "paused");
  assert.deepEqual(stopped.repositories.map(({ status }) => status), ["failed", "failed", "queued", "queued"]);
  assert.deepEqual(stopped, JSON.parse(await readFile(file, "utf8")));
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
  await verifyFailureGate(await verifyOwnerPriority());
  const paused = JSON.parse((await cli("campaign", "pause", statePath, "--json")).stdout);
  assert.deepEqual(paused.rollout, { state: "paused" });
  await verifyMcp(paused);
  console.log("acc-campaigns: the installed CLI, MCP server and standalone checker agree");
} finally {
  await rm(root, { recursive: true, force: true });
}
