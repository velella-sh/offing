import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import {
  checkContext, checkEvidence, contextArgs, explainArgs, receiptArgs,
  selectFinding, verifyReceipt, withRepository,
} from "./local-fix-consumer.mjs";

export async function replayFallback(cli, version) {
  // With no MCP connection, the host uses the installed commands from the checked Skill mapping.
  await withRepository(cli, async ({ offing, beforePath, scan, fix, head, assertWorkingTree }) => {
    const before = await scan();
    const { id } = selectFinding(before);
    checkEvidence(JSON.parse(await offing(...explainArgs(id))), id);
    checkContext(JSON.parse(await offing(...contextArgs(id))), id);
    await writeFile(beforePath, JSON.stringify(before));
    await fix();
    const receipt = JSON.parse(await offing(...receiptArgs(beforePath)));
    verifyReceipt(receipt, before, await scan(), id, true, version, head);
    await assertWorkingTree(true);
  });

  // The host starts after the edit. A new scan has no way to recover the prior finding.
  await withRepository(cli, async ({ offing, beforePath, scan, assertWorkingTree }) => {
    assert.deepEqual((await scan()).findings, []);
    await assert.rejects(offing(...receiptArgs(beforePath)), (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Cannot use --before: .*before\.json does not exist/);
      return true;
    });
    await assertWorkingTree(false);
  }, "v7");
  console.log("CLI fallback: saved before scan proves the selected finding resolved, no introduced findings, unrelated edit preserved.");
  console.log("CLI fallback negative control: missing before scan gives insufficient prior evidence.");
}
