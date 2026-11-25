import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateToolSelection,
  loadAdvertisedTools,
  loadToolSelectionCorpus,
  rankTools,
  selectTool,
  type AdvertisedTool,
} from "../benchmarks/skill-trigger-eval.js";
import { MCP_TOOL_NAMES } from "../src/mcp.js";
import { connectMcpClient } from "./mcp-client.js";

// The eval ranks tools by the words of their name, title, and description. These hold it to its own rules.

const tools: AdvertisedTool[] = [
  {
    name: "forecast_repository",
    title: "Forecast repository",
    description: "Call when you plan a roadmap and need to know what reaches end of life first.",
  },
  {
    name: "scan_repository",
    title: "Scan repository",
    description: "Call when you need the lifecycle findings of a repository at exact file and line.",
  },
  {
    name: "check_snippet",
    title: "Check snippet",
    description: "Call before you write a file, with its intended path and content.",
  },
  { name: "list_deprecations", title: "List deprecations", description: "Call when you need an overview." },
];

test("the tool selection corpus names one tool of the server for each prompt", async () => {
  const corpus = await loadToolSelectionCorpus();
  assert.equal(corpus.schemaVersion, "offing.mcp-tool-selection.v1");
  assert.ok(corpus.cases.length >= 50);
  for (const field of ["id", "prompt"] as const)
    assert.equal(new Set(corpus.cases.map((item) => item[field])).size, corpus.cases.length, `${field}s are unique`);
  for (const item of corpus.cases) {
    assert.ok((MCP_TOOL_NAMES as readonly string[]).includes(item.tool), `${item.id} names ${item.tool}`);
    assert.ok(item.reason.trim().length > 0, item.id);
  }
  for (const tool of MCP_TOOL_NAMES)
    assert.ok(corpus.cases.filter((item) => item.tool === tool).length >= 5, `${tool} has fewer than five prompts`);
});

test("a prompt ranks first the tool whose words it uses, and a word fewer tools share counts for more", () => {
  const names = (prompt: string) => rankTools(prompt, tools).map((tool) => tool.name);
  assert.equal(selectTool("Plan the roadmap for the next 12 months.", tools), "forecast_repository");
  assert.equal(selectTool("Give me the lifecycle findings with the exact file and line.", tools), "scan_repository");
  // "file" is in two descriptions, so it weighs less than a word of one; the zero-score tools follow by name.
  assert.deepEqual(names("Give me the lifecycle findings with the exact file and line."), [
    "scan_repository",
    "check_snippet",
    "forecast_repository",
    "list_deprecations",
  ]);
});

test("two words are one term across a shared stem, and never across a shorter shared start", () => {
  // "deprecated" and "deprecations" share six letters; nothing else in the tool list has the stem.
  assert.equal(selectTool("Which dependencies are deprecated?", tools), "list_deprecations");
  // "checkout" shares five letters with "check", which is not enough, so no tool scores and none is selected.
  assert.equal(selectTool("Is actions/checkout okay?", tools), undefined);
});

test("a tie selects nothing", () => {
  // "repository" is in two names and in no description, so forecast and scan score the same.
  assert.equal(selectTool("The repository", tools), undefined);
  // One word of one name is enough to decide.
  assert.equal(selectTool("Scan the repository", tools), "scan_repository");
});

test("the eval reads the tools the server advertises, and the recorded list it reads by default is that list", async () => {
  const client = await connectMcpClient();
  let advertised: AdvertisedTool[];
  try {
    const { tools: listed } = await client.request("tools/list");
    advertised = (listed as AdvertisedTool[]).map(({ name, title, description }) => ({
      name,
      ...(title ? { title } : {}),
      description,
    }));
  } finally {
    await client.close();
  }
  assert.deepEqual(await loadAdvertisedTools(), advertised);

  const { cases } = await loadToolSelectionCorpus();
  const metrics = calculateToolSelection(cases, advertised);
  assert.equal(metrics.cases, cases.length);
  assert.equal(metrics.selected + metrics.misses.length, metrics.cases);
  assert.equal(metrics.selectionRate, metrics.selected / metrics.cases);
  for (const miss of metrics.misses)
    assert.ok(
      miss.selected === undefined || advertised.some((tool) => tool.name === miss.selected),
      `${miss.id} was taken by a tool the server does not advertise`,
    );
});
