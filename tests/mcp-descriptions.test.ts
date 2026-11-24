import assert from "node:assert/strict";
import { test } from "node:test";

import { commands } from "../src/commands/index.generated.js";
import { MCP_TOOL_NAMES } from "../src/mcp.js";
import { MCP_TOOL_MORE_HINTS } from "../src/mcp/tool-names.js";
import { connectMcpClient } from "./mcp-client.js";

/** The longest a tool description may be: enough for when to call the tool, what it returns, and one caveat. */
const MAX_DESCRIPTION_WORDS = 60;

test("every tool description opens with when to call it and stays under 60 words", async () => {
  const client = await connectMcpClient();
  try {
    const tools = (await client.request("tools/list")).tools as Array<{ name: string; description: string }>;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...MCP_TOOL_NAMES],
    );
    for (const { name, description } of tools) {
      assert.match(description, /^Call (when|before) /, `${name} must open with when to call it`);
      const words = description.trim().split(/\s+/).length;
      assert.ok(words < MAX_DESCRIPTION_WORDS, `${name}: ${words} words, at most ${MAX_DESCRIPTION_WORDS - 1}`);
    }
  } finally {
    await client.close();
  }
});

test("every tool says where the rest of a cut answer is, and only names what exists", async () => {
  const client = await connectMcpClient();
  try {
    const listed = (await client.request("tools/list")).tools as Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
    }>;
    // A hint may name a tool, one of its inputs, or a command: nothing else an agent would look for.
    const tools = new Set(listed.map((tool) => tool.name));
    const inputs = new Set(listed.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {})));
    const cliCommands = new Set(commands.map((command) => command.name));

    for (const [name, hint] of Object.entries(MCP_TOOL_MORE_HINTS)) {
      assert.ok(tools.has(name), `${name} is not a tool`);
      assert.ok(hint.trim().length > 0 && !hint.includes("\n"), `${name} needs a one-line hint`);
      const mentioned = [...hint.matchAll(/offing ([a-z-]+)/g)].map((match) => match[1] ?? "");
      const nextTools = hint.split(/[^a-z_]+/).filter((word) => tools.has(word));
      assert.ok(
        mentioned.length + nextTools.length > 0,
        `${name}: the hint must name a command to run or a tool to call next`,
      );
      for (const command of mentioned) {
        assert.ok(cliCommands.has(command), `${name}: the hint names "offing ${command}", which is not a command`);
      }
      for (const word of hint.split(/[^a-z_]+/)) {
        if (!word.includes("_")) continue;
        assert.ok(
          tools.has(word) || inputs.has(word),
          `${name}: the hint names "${word}", which is not a tool or an input`,
        );
      }
    }
  } finally {
    await client.close();
  }
});
