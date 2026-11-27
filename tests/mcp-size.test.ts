import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { estimateTokens, MAX_TOOL_TOKENS, type MorePointer } from "../src/mcp/limit.js";
import { MCP_TOOL_NAMES } from "../src/mcp.js";
import { readCampaignState } from "../src/campaign/document.js";
import type { McpToolName } from "../src/mcp/tool-names.js";
import { connectMcpClient } from "./mcp-client.js";

const temporaryRoots: string[] = [];
/** Long enough that an answer which echoes it twice is three times the cap. */
const LONG_INPUT = "x".repeat(9000);

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A repository whose full answers are far over the cap for every tool that reads one: six hundred workflows on a
 * runtime that ended, one deprecated dependency used four thousand times, and five hundred PHP packages that block
 * an upgrade to 8.4.
 */
async function largeRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing mcp-size-"));
  temporaryRoots.push(root);
  const workflows = join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  const checkout = "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n";
  await Promise.all(
    Array.from({ length: 600 }, (_, index) =>
      writeFile(join(workflows, `ci-${String(index).padStart(4, "0")}.yml`), checkout),
    ),
  );
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "large", version: "1.0.0", dependencies: { request: "2.88.2" } }, null, 2)}\n`,
  );
  const calls = Array.from({ length: 4000 }, (_, index) => `const r${index} = require("request");\n`).join("");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.js"), calls);
  await writeFile(
    join(root, "composer.lock"),
    `${JSON.stringify(
      {
        packages: Array.from({ length: 500 }, (_, index) => ({
          name: `acme/package-${String(index).padStart(3, "0")}`,
          version: "1.0.0",
          require: { php: "^7.0" },
        })),
        "packages-dev": [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "compose.yaml"),
    "services:\n" + Array.from({ length: 50 }, (_, index) => `  web${index}:\n    image: node:24\n`).join(""),
  );
  return root;
}

/** `util.isArray` is a removed Node.js API, so every call is one finding. */
const SNIPPET = Array.from(
  { length: 40 },
  (_, index) => `const util${index} = require("node:util");\nif (util${index}.isArray(x)) {}\n`,
).join("");

test("every tool keeps its answer under 2,000 tokens on a large input, valid against its advertised schema", async () => {
  const root = await largeRepository();
  const client = await connectMcpClient();
  try {
    const tools = (await client.request("tools/list")).tools as Array<{
      name: string;
      outputSchema?: Record<string, unknown>;
    }>;
    // Validate with only what the client received, as a client would.
    const validators = new Map(
      tools.map((tool) => [
        tool.name,
        new Ajv2020({ allErrors: true, strict: false }).compile(tool.outputSchema as object),
      ]),
    );

    const sbom = join(root, "many.sbom.json");
    await writeFile(
      sbom,
      JSON.stringify({
        descriptor: { name: "syft" },
        artifacts: Array.from({ length: 40 }, () => ({ purl: "pkg:npm/request@2.88.2" })),
      }),
    );

    const state = await readCampaignState("docs/spec/campaign/conformance/valid-state.json");
    const sample = state.repositories[0]!;
    const statePath = join(root, "campaign-state.json");
    const repositories = Array.from({ length: 80 }, (_, index) => ({
      ...sample,
      name: `example/repository-${index}`,
      batch: Math.floor(index / state.batching.size) + 1,
    }));
    await writeFile(statePath, JSON.stringify({ ...state, repositories }));
    // Declared for every tool, so a new tool cannot be added without a large input here.
    const calls = {
      scan_repository: { repository_path: root },
      image_lineage: { repository_path: root },
      campaign_status: { state_path: statePath },
      stack_context: { repository_path: root },
      simulate_upgrade: { repository_path: root, targets: ["nodejs@22"], as_of: "2026-01-01", effort: true },
      scan_sbom: { sbom_path: sbom },
      list_deprecations: { repository_path: root },
      explain_deprecation: { finding_id: "npm.package.request.deprecated:package.json:5", repository_path: root },
      create_migration_context: { finding_id: "npm.package.request.deprecated:package.json:5", repository_path: root },
      verify_migration: { finding_id: "npm.package.request.deprecated:package.json:5", repository_path: root },
      check_dependency: { purl: `pkg:npm/${LONG_INPUT}` },
      check_upgrade: { path: root, target: "php@8.4" },
      check_snippet: { path: "src/many.js", content: SNIPPET },
      agent_guard: {
        schemaVersion: "offing.agent-guard.request.v1",
        snippet: { path: "src/many.js", content: SNIPPET },
      },
      forecast_repository: { repository_path: root, months: 24, as_of: "2025-01-01" },
      plan_migrations: { repository_path: root },
      recommend_version: { product: `no-such-product-${LONG_INPUT}` },
    } satisfies Record<McpToolName, Record<string, unknown>>;
    assert.deepEqual(Object.keys(calls).sort(), [...MCP_TOOL_NAMES].sort(), "every tool is exercised");

    for (const name of MCP_TOOL_NAMES) {
      const result = await client.request("tools/call", { name, arguments: calls[name] });
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      assert.notEqual(result.isError, true, `${name} failed: ${text}`);
      const answer = result.structuredContent as Record<string, unknown>;

      const tokens = estimateTokens(text);
      assert.ok(tokens <= MAX_TOOL_TOKENS, `${name}: ${tokens} tokens, over the cap of ${MAX_TOOL_TOKENS}`);
      const validate = validators.get(name);
      assert.ok(validate, `${name} advertises an output schema`);
      assert.equal(validate(answer), true, `${name}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
      assert.deepEqual(JSON.parse(text), answer, `${name}: the JSON text is the structured content`);

      if (name === "agent_guard") {
        assert.equal(answer.more, undefined, "a verdict carries one finding at most");
        continue;
      }

      if (name === "stack_context") {
        assert.ok(tokens <= 1_000, `stack_context: ${tokens} estimated tokens`);
        assert.equal(typeof answer.omitted, "number", "the document carries its own omission count");
        continue;
      }

      // The inputs are large, so it is the cap that keeps each answer short, and the pointer says so.
      const more = answer.more as MorePointer | undefined;
      assert.equal(more?.truncated, true, `${name}: the answer was not cut, so this input does not reach the cap`);
      assert.equal(more.estimatedTokens, tokens, `${name}: the pointer reports the size of the answer as returned`);
      assert.ok(more.omitted.length + (more.clipped?.length ?? 0) > 0, `${name}: the pointer names what is missing`);
      for (const entry of more.omitted)
        assert.ok(entry.shown < entry.total, `${name}: ${entry.path} is not missing anything`);
    }
  } finally {
    await client.close();
  }
});
