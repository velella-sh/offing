import assert from "node:assert/strict";
import { snapshot, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Finding } from "../src/domain.js";
import { renderComment } from "../src/github-action.js";
import { selectChangedAnnotations } from "../src/github-action/diff.js";

snapshot.setResolveSnapshotPath(() =>
  fileURLToPath(new URL("../../tests/pr-countdown.test.js.snapshot", import.meta.url)),
);

const today = "2026-11-01";
const receipt = "https://github.com/example/repo/actions/runs/42#artifacts";
const evidence = "https://example.com/lifecycle";

function dated(path: string, line: number, deadline: string): Finding {
  return {
    id: `runtime:${path}:${line}`,
    ruleId: `runtime-${deadline}`,
    detector: "npm",
    title: "Runtime support",
    summary: "Support ends",
    severity: "low",
    confidence: "exact",
    location: { path, line },
    deadline,
    sources: [{ title: "Lifecycle policy", url: evidence }],
  };
}

const outside = dated("old.env", 1, "2026-11-02");
const changed = new Map([["Dockerfile", [{ start: 2, end: 4 }]]]);

function render(findings: Finding[], packages?: { path: string; findings: Finding[] }[]): string {
  const selected = selectChangedAnnotations(findings, changed).annotated;
  return renderComment(
    findings,
    false,
    "none",
    undefined,
    false,
    undefined,
    undefined,
    packages,
    undefined,
    undefined,
    {
      today,
      findings: selected,
      timelineFindings: findings,
      receiptUrl: receipt,
    },
  );
}

test("snapshots the comment with no findings, outside the diff, and on changed lines", (t) => {
  t.assert.snapshot(render([]).split("\n"));
  t.assert.snapshot(render([outside]).split("\n"));
  t.assert.snapshot(
    render([
      dated("Dockerfile", 4, "2027-02-01"),
      dated("Dockerfile", 3, "2026-11-01"),
      outside,
      dated("Dockerfile", 2, "2026-11-01"),
    ]).split("\n"),
  );
});

test("past dates and undated findings are distinguished from upcoming deadlines", () => {
  const ended = dated("Dockerfile", 2, "2026-10-31");
  const { deadline: _, ...undated } = dated("Dockerfile", 3, "2026-11-02");
  const text = render([ended, undated]);
  assert.match(text, /0 things this PR touches end within 90 days/);
  assert.match(text, /2026-10-31 · ended 1 day ago/);
  assert.doesNotMatch(text.split("| Severity | Findings |")[0] ?? "", /Dockerfile:3/);
});

test("a comment with 500 findings keeps whole Markdown sections, counts, and links within GitHub's limit", () => {
  const findings = Array.from({ length: 500 }, (_, index) => ({
    ...dated("Dockerfile", 2, "2026-11-04"),
    id: `dated:${index}`,
    title: `Event ${index} ${"🙂|".repeat(220)}`,
  }));
  const packages = findings.map((finding, i) => ({ path: `packages/${i}`, findings: [finding] }));
  const text = render(findings, packages);
  assert.ok(Buffer.byteLength(text, "utf8") <= 65_536);
  assert.match(text, /^<!-- offing-pr-comment -->/);
  assert.match(text, /500 things this PR touches end within 90 days/);
  assert.match(text, /485 more dated findings/);
  assert.match(text, /omitted to fit GitHub/);
  assert.match(text, /\[Receipt\]/);
  assert.match(text, /\[Evidence\]/);
});
