import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

import { checkStackContext } from "./check.mjs";

const [command, ...args] = process.argv.slice(2);
assert(command, "Usage: node consumer.mjs <implementation command> [arguments]");
const workspace = await mkdtemp(join(tmpdir(), "offing-freshness-"));
const env = { ...process.env, OFFING_DATA_VERSION: "bundled", OFFING_CACHE_DIR: join(workspace, "cache"), OFFING_NO_CACHE: "0" };

function cli(argv, input = "", cwd = workspace) {
  const result = spawnSync(command, [...args, ...argv], { cwd, env, input, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

async function mcp() {
  const child = spawn(command, [...args, "mcp"], { cwd: workspace, env, stdio: ["pipe", "pipe", "inherit"] });
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
    send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "freshness-check", version: "1" } }, 1);
    const { instructions } = await receive(1);
    assert.match(instructions, /Offing performs deterministic deprecation analysis/);
    assert.match(instructions, /Stack context: .*nodejs 18/);
    send("notifications/initialized");
    send("tools/list", {}, 2);
    assert.equal((await receive(2)).tools.filter(({ name }) => name === "stack_context").length, 1);
    send("resources/list", {}, 3);
    assert((await receive(3)).resources.some(({ uri }) => uri === "offing://stack/context"));
    send("tools/call", { name: "stack_context", arguments: {} }, 4);
    const tool = await receive(4);
    assert(!tool.isError, JSON.stringify(tool));
    send("resources/read", { uri: "offing://stack/context" }, 5);
    const resource = await receive(5);
    assert.deepEqual(JSON.parse(resource.contents[0].text), tool.structuredContent);
    assert.deepEqual(JSON.parse(tool.content[0].text), tool.structuredContent);
    return tool.structuredContent;
  } finally {
    clearTimeout(timeout);
    input.close();
    child.stdin.end();
    child.kill();
  }
}

function hookContext(hook) {
  assert.equal(hook.stderr, "");
  const { hookSpecificOutput } = JSON.parse(hook.stdout);
  assert.equal(hookSpecificOutput.hookEventName, "SessionStart");
  return JSON.parse(hookSpecificOutput.additionalContext.slice(hookSpecificOutput.additionalContext.indexOf("\n") + 1));
}

async function verifyWarmExamples(examples) {
  for (const fixture of [
    "demo", "forecast/node-before", "forecast/node-after", "forecast/python-before", "forecast/python-after",
    "forecast/actions-before", "forecast/actions-after",
  ]) {
    const cwd = join(workspace, "examples", fixture);
    await cp(join(examples, fixture), cwd, { recursive: true });
    if (fixture === "demo" || fixture.startsWith("forecast/node")) {
      await rename(join(cwd, "package.json.fixture"), join(cwd, "package.json"));
    }
    cli(["scan", ".", "--json"], "", cwd);
    const start = performance.now();
    const hook = cli(["hook", "session-start", "claude-code"], "{}", cwd);
    const milliseconds = performance.now() - start;
    await checkStackContext(hookContext(hook));
    assert(milliseconds < 1_000, `${fixture}: warm hook took ${milliseconds.toFixed(1)} ms`);
    console.log(`acc-freshness-context: ${fixture}: ${milliseconds.toFixed(1)} ms using the verified warm cache`);
  }
}

try {
  const packageJson = JSON.stringify({ name: "freshness-fixture", dependencies: { request: "2.88.2" } });
  await writeFile(join(workspace, "package.json"), packageJson);
  await writeFile(join(workspace, ".nvmrc"), "18\n");
  await writeFile(join(workspace, ".tool-versions"), "golang 1.25\n");
  await writeFile(join(workspace, ".python-version"), "3.12\n");
  await writeFile(join(workspace, "index.cjs"), 'const util = require("node:util");\nutil.isArray([]);\n');
  await writeFile(join(workspace, "main.py"), "from datetime import datetime\nprint(datetime.utcnow())\n");
  const miss = cli(["hook", "session-start", "claude-code"], "{}");
  assert.equal(miss.stdout, "");
  assert.match(miss.stderr, /^Offing stack context unavailable:[^\n]*\n$/);
  cli(["scan", ".", "--json"]);
  const context = await mcp();
  await checkStackContext(context);
  await assert.rejects(checkStackContext({ ...context, omitted: -1 }));
  await assert.rejects(checkStackContext({ ...context, avoid: Array.from({ length: 35 }, () => context.avoid[0]) }), /exceeds 1,000/);
  assert(context.components.some(({ component, inUse, endOfLife }) =>
    component === "nodejs" && inUse === "18" && endOfLife === "2025-04-30",
  ));
  assert(context.components.some(({ component, inUse, endOfLife }) =>
    component === "go" && inUse === "1.25" && endOfLife === "2026-08-19",
  ));
  assert(context.avoid.some(({ ruleId, replacement }) => ruleId === "npm.package.request.deprecated" && replacement));
  assert(context.avoid.some(({ kind, ruleId, replacement }) =>
    kind === "api" && ruleId === "nodejs.symbol.util.isarray" && replacement === "Array.isArray()",
  ));
  assert(context.avoid.some(({ kind, ruleId, replacement }) =>
    kind === "api" && ruleId === "python.symbol.datetime.utcnow" && replacement === "datetime.now(datetime.UTC)",
  ));
  const payload = JSON.stringify({ hook_event_name: "SessionStart", cwd: workspace });
  const hook = cli(["hook", "session-start", "claude-code"], payload);
  assert.deepEqual(hookContext(hook), context);
  assert.equal(await readFile(join(workspace, "package.json"), "utf8"), packageJson);
  await writeFile(join(workspace, "index.cjs"), "const current = Array.isArray([]);\n");
  const stale = cli(["hook", "session-start", "claude-code"], payload);
  assert.equal(stale.stdout, "");
  assert.match(stale.stderr, /^Offing stack context unavailable:[^\n]*\n$/);
  const examples = process.env.OFFING_FRESHNESS_EXAMPLES;
  if (examples) await verifyWarmExamples(examples);
  console.log("acc-freshness-context: packaged hook, MCP tool, resource, instructions, schema and budget passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
