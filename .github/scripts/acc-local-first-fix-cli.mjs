import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  checkContext, checkEvidence, contextArgs, explainArgs, receiptArgs, scanArgs,
  selectFinding, verifyReceipt, withRepository,
} from "./local-fix-consumer.mjs";

const [installed, version] = process.argv.slice(2);
if (!installed || !version) throw new Error("Usage: acc-local-first-fix-cli.mjs <installed cli.js> <version>");
const cli = resolve(installed);

const quickstart = await readFile(new URL("../../docs/QUICKSTART.md", import.meta.url), "utf8");
assert.match(quickstart, /## 3\. Read the evidence[^\n]*\n[\s\S]*?\]\(RECEIPTS\.md#verify-one-local-edit\)[\s\S]*?## 4\./);
const docs = await readFile(new URL("../../docs/RECEIPTS.md", import.meta.url), "utf8");
const recipe = docs.split("## Verify one local edit\n")[1]?.split("\n## ")[0];
assert.ok(recipe, "the linked receipt recipe exists");
assert.deepEqual(recipe.match(/^offing .+$/gm), [
  `offing ${scanArgs.join(" ")} > "$evidence_dir/before.json"`,
  `offing ${explainArgs('"$finding_id"').join(" ")}`,
  `offing ${contextArgs('"$finding_id"').join(" ")}`,
  `offing ${receiptArgs('"$evidence_dir/before.json"').join(" ")} > "$evidence_dir/verification.json"`,
  `offing ${scanArgs.join(" ")} > "$evidence_dir/after.json"`,
]);
assert.match(recipe, /evidence_dir="\$\(mktemp -d\)"/);
assert.match(recipe, /no\s+supported findings you can address, stop/);

await withRepository(cli, async ({ offing, beforePath, scan, fix, head, assertWorkingTree }) => {
  const before = await scan();
  const { id } = selectFinding(before);
  await writeFile(beforePath, JSON.stringify(before));
  checkEvidence(JSON.parse(await offing(...explainArgs(id))), id);
  checkContext(JSON.parse(await offing(...contextArgs(id))), id);

  // The command exits zero without a fix. The receipt must still say the finding remains.
  const unchanged = JSON.parse(await offing(...receiptArgs(beforePath)));
  verifyReceipt(unchanged, before, await scan(), id, false, version, head);
  await assertWorkingTree(false);

  await fix();
  const receipt = JSON.parse(await offing(...receiptArgs(beforePath)));
  verifyReceipt(receipt, before, await scan(), id, true, version, head);
  await assertWorkingTree(true);
});

await withRepository(cli, async ({ scan, assertWorkingTree }) => {
  assert.deepEqual((await scan()).findings, [], "no supported finding to act on");
  await assertWorkingTree(false);
}, "v7");

console.log("acc-local-first-fix-cli: selected finding resolved after an uncommitted edit, no introduced findings, unrelated edit preserved.");
console.log("Negative controls: unchanged finding remains despite exit zero, clean repository stops before verification.");
console.log("Project checks: not run in the disposable fixture.");
