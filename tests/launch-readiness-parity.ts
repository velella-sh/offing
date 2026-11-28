import assert from "node:assert/strict";
import type { collectReadiness } from "../tools/launch-readiness.js";

type Report = Awaited<ReturnType<typeof collectReadiness>>;

export function assertReadinessParity(markdown: string, json: string): void {
  const report: Report = JSON.parse(json);
  const table = markdown.split("\n").filter((line) => line.startsWith("| ") && line.endsWith(" |"));
  const rows = table.slice(2).map((line) => {
    const cells = line.slice(2, -2).split(" | ");
    assert.equal(cells.length, 5, line);
    const [name, status, observed, thresholds, sources = ""] = cells;
    const evidence = [...sources.matchAll(/\[Source \d+\]\((https:\/\/[^)]+)\)/gu)].map(([, url]) => url);
    return { name, status, observed: observed?.replaceAll("\\|", "|"), thresholds, evidence };
  });
  assert.equal(rows.length, 10);
  assert.deepEqual(rows, report.checks);
}
