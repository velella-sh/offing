import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { contextArgs, explainArgs, receiptArgs, scanArgs } from "./local-fix-consumer.mjs";
import { replayFallback } from "./local-fix-fallback.mjs";
import { replayMcp } from "./local-fix-mcp.mjs";

const [installed, version] = process.argv.slice(2);
if (!installed || !version) throw new Error("Usage: acc-local-first-fix-agent.mjs <installed cli.js> <version>");
const cli = resolve(installed);
const packageRoot = resolve(dirname(cli), "../..");
const skillPath = "skills/offing/SKILL.md";
const skill = await readFile(join(packageRoot, skillPath), "utf8");
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
assert.equal(metadata.name, "@velella/offing");
assert.equal(metadata.version, version);
for (const host of ["claude", "codex"]) {
  assert.equal(skill, await readFile(new URL(`../../plugins/${host}/${skillPath}`, import.meta.url), "utf8"),
    `installed Skill differs from the built ${host} Skill`);
}

const beforeStep = "save the before scan outside the repository before editing";
function checkGuidance(contents) {
  const workflow = contents.split("## Scan and migrate\n")[1]?.split("\n## ")[0];
  assert.ok(workflow, "Scan and migrate guidance exists");
  assert.ok(workflow.includes(beforeStep), "Skill must capture fallback evidence before the edit");
  for (const phrase of ["same session", "was resolved or remains", "insufficient prior evidence", "introduced findings", "Report project checks separately"]) {
    assert.ok(workflow.includes(phrase), `missing Skill guidance: ${phrase}`);
  }
  const findTool = (intent, command) => {
    const row = contents.split("\n").find((line) => line.startsWith(`| ${intent} |`));
    assert.ok(row, `missing Skill mapping: ${intent}`);
    const [, , tool, fallback] = row.split("|").map((cell) => cell.trim().replace(/^`|`$/g, ""));
    assert.equal(fallback, `offing ${command.join(" ")}`);
    return tool;
  };
  const mapping = {
    scan: findTool("Full discovery", [scanArgs[0], "<path>", scanArgs[2]]),
    explain: findTool("Evidence and impact", explainArgs("'<finding-id>'").map((arg) => arg === "." ? "<path>" : arg)),
    context: findTool("Migration packet", contextArgs("'<finding-id>'").map((arg) => arg === "." ? "<path>" : arg)),
    verify: findTool("Fresh verification", receiptArgs("<before-scan>").map((arg) => arg === "." ? "<path>" : arg)),
  };
  assert.deepEqual(mapping, {
    scan: "scan_repository", explain: "explain_deprecation",
    context: "create_migration_context", verify: "verify_migration",
  });
  return mapping;
}

const tools = checkGuidance(skill);
assert.throws(() => checkGuidance(skill.replace(beforeStep, "apply the edit")), /capture fallback evidence before the edit/);
await replayMcp(cli, version, tools);
await replayFallback(cli, version);
console.log("acc-local-first-fix-agent: installed Skill and both host bundles agree. Removed evidence guidance is rejected.");
console.log("Project checks: not run in the disposable fixtures. Provider: deterministic local replay.");
