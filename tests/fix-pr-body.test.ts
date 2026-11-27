import assert from "node:assert/strict";
import { test } from "node:test";

import type { Finding, ScanResult } from "../src/domain.js";
import type { FixRefusal } from "../src/fix/index.js";
import { renderFixPullRequestBody } from "../src/fix-pr-body.js";
import { buildReceipt } from "../src/receipt.js";
import { buildVerifyResult, VERIFY_RESULT_ARTIFACT, VERIFY_RESULT_MARKER } from "../src/verify-result.js";

const finding: Finding = {
  id: "actions.checkout:.github/workflows/ci.yml:4",
  title: "Unsupported actions/checkout runtime",
  summary: "Update the Action",
  detector: "github-actions",
  ruleId: "actions.checkout",
  severity: "medium",
  confidence: "exact",
  location: { path: ".github/workflows/ci.yml", line: 4 },
  sources: [{ title: "Lifecycle evidence", url: "https://github.com/actions/checkout" }],
};
const before: ScanResult = {
  schemaVersion: "offing.scan.v1",
  root: ".",
  scannedAt: "",
  findings: [finding],
  diagnostics: [],
};
const after = { ...before, findings: [] };
const receipt = buildReceipt(before, after);
const verification = buildVerifyResult(receipt, before, after);
const input = {
  fixed: [finding],
  patches: [
    { fixer: "actions", path: finding.location.path, diff: "" },
    { fixer: "actions", path: "build.yml", diff: "" },
  ],
  refusals: [
    {
      fixer: "runtime",
      findingId: "test'quote|file",
      ruleId: "runtime",
      path: "package.json",
      reason: "No supported version",
    },
  ],
  receipt,
  verification,
  attribution: true,
  artifactUrl: "https://github.com/o/r/actions/runs/123#artifacts",
};

test("the evidence table comes before the receipt, fixer groups, and artifact-backed refusals", () => {
  const body = renderFixPullRequestBody(input);
  assert.match(body, /^## Offing lifecycle fixes\n/);
  assert.match(
    body,
    /\| Unsupported actions\/checkout runtime \| `\.github\/workflows\/ci\.yml:4` \| \[Lifecycle evidence\]/,
  );
  assert.ok(body.indexOf("| Finding") < body.indexOf("## Offing receipt"));
  assert.match(body, /`actions` · `\.github\/workflows\/ci\.yml`, `build\.yml`/);
  assert.match(body, /`runtime` · No supported version · `offing context /);
  assert.ok(body.includes("quote|file"));
  const fenced = body.split(VERIFY_RESULT_MARKER + "\n```json\n")[1]?.split("\n```")[0];
  assert.ok(fenced);
  assert.deepEqual(JSON.parse(fenced), verification);
  assert.match(body, /\[`offing-fix\.patch`\]\(https:\/\/github.com\/o\/r\/actions\/runs\/123#artifacts\)/);
  assert.match(body, /Scanned by \[Offing\]/);
});

test("long refusal lists collapse and large UTF-8 receipts link the canonical artifact", () => {
  const refusals: FixRefusal[] = Array.from({ length: 50 }, (_, index) => ({
    fixer: "runtime",
    findingId: `finding-${index}`,
    ruleId: "runtime",
    path: "package.json",
    reason: "No target",
  }));
  const collapsed = renderFixPullRequestBody({ ...input, refusals });
  assert.match(collapsed, /<summary>Refusals \(50\)<\/summary>/);
  assert.match(collapsed, /Showing 40 of 50/);
  const large = renderFixPullRequestBody({
    ...input,
    attribution: false,
    fixed: [{ ...finding, title: "🧪".repeat(20_000) }],
  });
  assert.ok(Buffer.byteLength(large, "utf8") < 64_000);
  assert.match(large, new RegExp(`Artifact: \`${VERIFY_RESULT_ARTIFACT}\``));
  assert.doesNotMatch(large, /Scanned by/);
});
