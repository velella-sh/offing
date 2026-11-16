import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

test("checks old Action versions and workflow commands with replacement guidance", async () => {
  const cases = [
    ["- uses: actions/checkout@v2", "checkout.node20", "actions/checkout@v5"],
    ['echo "::set-output name=x::value"', "workflow-command.set-output", "$GITHUB_OUTPUT"],
    ['echo "::save-state name=x::value"', "workflow-command.save-state", "$GITHUB_STATE"],
    ['echo "::set-env name=x::value"', "workflow-command.set-env", "$GITHUB_ENV"],
    ['echo "::add-path::/x"', "workflow-command.add-path", "$GITHUB_PATH"],
  ] as const;
  const { findings } = await checkSnippet({
    path: ".github/workflows/ci.yml",
    content: [
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      ${cases[0][0]}`,
      "      - run: |",
      ...cases.slice(1).map(([code]) => `          ${code}`),
    ].join("\n"),
  });
  for (const [code, rule, replacement] of cases) {
    const found = findings.find((finding) => finding.ruleId === `github-actions.${rule}`);
    assert.ok(found, rule);
    assert.equal(found.code, code);
    assert.ok(found.replacement?.startsWith(replacement));
    assert.deepEqual(found.source, found.sources[0]);
  }
});
