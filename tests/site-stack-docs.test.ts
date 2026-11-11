import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { commands } from "../src/commands/index.generated.js";
import { renderHelp } from "../src/completions.js";

const read = (path: string) => readFile(resolve(path), "utf8");

const siteStackDoc = resolve("docs/SITE_STACK.md");
const sampleAgents = resolve("examples/agents/site-stack/AGENTS.md");

const offingSubcommandsIn = (text: string) =>
  [...text.matchAll(/(?:^|\s|`|@velella\/)offing ([a-z][a-z0-9-]*)/g)].map((match) => match[1]!);

test("the site stack guide and sample exist and name Offing", async () => {
  await access(siteStackDoc);
  await access(sampleAgents);

  const guide = await read(siteStackDoc);
  const sample = await read(sampleAgents);

  for (const [label, text] of [
    ["SITE_STACK.md", guide],
    ["examples/agents/site-stack/AGENTS.md", sample],
  ] as const) {
    assert.match(text, /Offing/i, label);
  }

  assert.match(sample, /offing check/, "the sample tells agents to check before adding deps");
});

test("every offing subcommand in the sample appears in the CLI usage text", async () => {
  const sample = await read(sampleAgents);
  const help = renderHelp(commands);

  const subcommands = [...new Set(offingSubcommandsIn(sample))];
  assert.ok(subcommands.length >= 2, "the sample should reference at least check and scan");
  assert.deepEqual(subcommands.sort(), ["check", "scan"]);

  for (const subcommand of subcommands) {
    assert.ok(help.includes(`offing ${subcommand}`), `CLI HELP should document \`offing ${subcommand}\``);
  }
});
