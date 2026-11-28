import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import {
  checkContext, checkEvidence, selectFinding, verifyReceipt, withRepository,
} from "./local-fix-consumer.mjs";

async function withSession(cli, root, env, use) {
  const server = spawn(process.execPath, [cli, "mcp"], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
  const done = once(server, "close");
  const output = createInterface({ input: server.stdout });
  const messages = output[Symbol.asyncIterator]();
  const timeout = setTimeout(() => server.kill(), 15_000);
  const send = (method, params, id) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  let nextId = 0;
  async function request(method, params) {
    const id = ++nextId;
    send(method, params, id);
    for (;;) {
      const line = await messages.next();
      if (line.done) throw new Error(`MCP disconnected waiting for ${method}`);
      const reply = JSON.parse(line.value);
      if (reply.id !== id) continue;
      assert.equal(reply.error, undefined, JSON.stringify(reply.error));
      return reply.result;
    }
  }
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "offing-local-fix-replay", version: "1" },
    });
    assert.ok(initialized.capabilities.tools);
    send("notifications/initialized");
    return await use((name, args = {}) => request("tools/call", {
      name, arguments: { repository_path: root, ...args },
    }));
  } finally {
    clearTimeout(timeout);
    output.close();
    server.stdin.end();
    server.kill();
    await done;
  }
}

function success(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.ok(result.structuredContent, "structured MCP data required");
  return result.structuredContent;
}

export async function replayMcp(cli, version, tools) {
  await withRepository(cli, async ({ root, env, scan, fix, head, assertWorkingTree }) => {
    const findingId = await withSession(cli, root, env, async (call) => {
      const before = success(await call(tools.scan));
      const { id } = selectFinding(before);
      const input = { finding_id: id };
      checkEvidence(success(await call(tools.explain, input)), id);
      checkContext(success(await call(tools.context, input)), id);

      const unchanged = success(await call(tools.verify, input));
      assert.equal(unchanged.findingId, id);
      assert.equal(unchanged.verified, false);
      assert.deepEqual(unchanged.remainingFindings.map(({ id }) => id), [id]);
      verifyReceipt(unchanged.verifyResult, before, await scan(), id, false, version, head);
      await assertWorkingTree(false);

      await fix();
      const verification = success(await call(tools.verify, input));
      assert.equal(verification.findingId, id);
      assert.equal(verification.verified, true);
      assert.deepEqual(verification.remainingFindings, []);
      verifyReceipt(verification.verifyResult, before, await scan(), id, true, version, head);
      await assertWorkingTree(true);
      return id;
    });

    await withSession(cli, root, env, async (call) => {
      const restarted = await call(tools.verify, { finding_id: findingId });
      assert.equal(restarted.isError, true);
      assert.equal(restarted._meta?.offing?.code, "finding-not-observed");
      assert.equal(restarted.structuredContent, undefined);
      await assertWorkingTree(true);
    });
  });
  console.log("MCP: selected finding resolved in the observing session, no introduced findings, unrelated edit preserved.");
  console.log("MCP negative controls: unchanged finding remains, restarted session has insufficient prior evidence.");
}
