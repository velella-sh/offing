import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { installedHook, type StableHost } from "./agent-hooks-e2e/fixture.js";
import { connectMcpClient } from "./mcp-client.js";

interface GuardFixture {
  id: string;
  request: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

const conformance = resolve("docs/spec/agent-guard/conformance");
const fixtures = JSON.parse(await readFile(join(conformance, "fixtures.json"), "utf8")) as GuardFixture[];
const cli = resolve("dist/src/cli.js");

function runCliGuard(input: string) {
  return spawnSync(process.execPath, [cli, "guard", "--protocol"], {
    input,
    encoding: "utf8",
    env: { ...process.env, OFFING_DATA_VERSION: "bundled" },
  });
}

test("Agent Guard CLI and MCP give the same response for every valid conformance request", async (t) => {
  const client = await connectMcpClient();
  t.after(() => client.close());
  for (const { id, request, expected } of fixtures) {
    const { status, stdout, stderr } = runCliGuard(JSON.stringify(request));
    const mcp = await client.request("tools/call", { name: "agent_guard", arguments: request });
    if (expected === null) {
      assert.equal(status, 2, id);
      assert.equal(stdout, "", id);
      assert.ok(stderr.trim(), id);
      assert.equal(mcp.isError, true, id);
      assert.equal(mcp.structuredContent, undefined, id);
      continue;
    }
    assert.equal(status, 0, `${id}: ${stderr}`);
    const response = JSON.parse(stdout);
    assert.deepEqual(mcp.structuredContent, response, id);
    for (const [field, value] of Object.entries(expected)) assert.equal(response[field], value, id);
  }
  const invalid = runCliGuard("{");
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /UTF-8 JSON request/);
});

test("the standalone conformance checker runs the reference from outside Offing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-agent-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["check.mjs", "fixtures.json"]) await copyFile(join(conformance, name), join(directory, name));
  await copyFile(resolve("docs/spec/agent-guard/example/guard.mjs"), join(directory, "guard.mjs"));
  const result = spawnSync(process.execPath, ["check.mjs", process.execPath, "guard.mjs"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`acc-guard-protocol: ${fixtures.length} cases passed`));
});

function beforeImageWrite(hook: Awaited<ReturnType<typeof installedHook>>, host: StableHost, content: string) {
  if (host !== "codex") return hook.beforeWrite("Write", { file_path: "image/Dockerfile", content });
  const patch = content
    .trimEnd()
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
  return hook.beforeWrite("apply_patch", {
    command: `*** Begin Patch\n*** Add File: image/Dockerfile\n${patch}\n*** End Patch`,
  });
}

for (const host of ["claude-code", "codex", "cursor"] as const) {
  test(`${host} pre-write hook enforces the Agent Guard snippet fixtures`, async (t) => {
    const hook = await installedHook(t, host);
    for (const fixture of fixtures.filter((item) => item.id === "end-of-life-image" || item.id === "supported-image")) {
      const { content } = fixture.request.snippet as { content: string };
      const result = beforeImageWrite(hook, host, content);
      if (fixture.expected?.decision === "allow") {
        assert.deepEqual([result.status, result.stdout, result.stderr], [0, "", ""], fixture.id);
      } else if (host === "cursor") {
        assert.equal(result.status, 0);
        const response = JSON.parse(result.stdout);
        assert.equal(response.permission, "deny");
        assert.match(response.agent_message, /node:22/);
      } else {
        assert.equal(result.status, 2);
        assert.match(result.stderr, /node:22/);
      }
    }
  });
}
