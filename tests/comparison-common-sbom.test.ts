import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHeroDevs, comparePublicClaims } from "../benchmarks/comparison/herodevs/build.js";
import { filterNpmSbom } from "../benchmarks/comparison/herodevs/collect.js";
import type { ClaimsSnapshot, SbomCapture } from "../benchmarks/comparison/herodevs/types.js";
import { renderComparisonCollections } from "../benchmarks/comparison/site.js";

test("shared SBOM input keeps distinct exact npm versions and counts exclusions", () => {
  const sbom = {
    descriptor: { version: "0.92.0" },
    artifacts: [
      { purl: "pkg:npm/next@14.0.0" },
      { purl: "pkg:npm/next@14.0.0" },
      { purl: "pkg:npm/next" },
      { purl: "pkg:npm/next@latest" },
      { purl: "pkg:github/actions/checkout@abc123" },
      {},
    ],
  };
  assert.deepEqual(filterNpmSbom(sbom), ["pkg:npm/next@14.0.0"]);
  assert.deepEqual(sbom.artifacts, [{ purl: "pkg:npm/next@14.0.0" }]);
});

test("compares exact public dates and preserves missing, conflicting and unmeasured cases", () => {
  const source = "https://example.com/support";
  const dates = [{ purl: "pkg:npm/a@1.0.0", ruleId: "a", eol: "2026-01-01", source }];
  const capture: SbomCapture = {
    offingVersion: "0.1.1",
    offingCommit: "test",
    dataVersion: "0.2.0",
    syftVersion: "0.92.0",
    cases: [
      {
        repository: "test/fixture",
        commit: "test",
        packages: [
          "pkg:npm/a@1.0.0",
          "pkg:npm/a@2.0.0",
          "pkg:npm/a@1.0.1",
          "pkg:npm/a@1.0.1-rc.1",
          "pkg:npm/a@1.0.2",
          "pkg:npm/unknown@1.0.0",
        ],
        excluded: 3,
        offing: [
          ...dates,
          { purl: "pkg:npm/a@1.0.1", ruleId: "b", eol: "2026-02-01", source },
          { purl: "pkg:npm/a@1.0.2", ruleId: "c", eol: "2026-02-01", source },
          { purl: "pkg:npm/a@1.0.2", ruleId: "d", eol: "2026-03-01", source },
        ],
      },
    ],
  };
  const snapshot: ClaimsSnapshot = {
    checkedAt: "2026-10-01",
    claims: [1, 2].map((major) => ({
      purl: "pkg:npm/a",
      major,
      eol: "2026-01-01",
      publishedAt: null,
      source,
    })),
  };
  const { totals } = comparePublicClaims(capture, snapshot);
  assert.deepEqual(totals, {
    repositories: 1,
    inventoried: 6,
    excluded: 3,
    matched: 4,
    noPublicDate: 2,
    agree: 1,
    "date-differs": 1,
    "hero-only": 1,
    "ambiguous-offing": 1,
  });
});

test("Mizzen HeroDevs counts and losses come from the measured artifact", async () => {
  const [actual, collections] = await Promise.all([buildHeroDevs("."), renderComparisonCollections(".")]);
  const charts = collections["docs/_data/comparison.json"];
  const losses = collections["docs/_data/comparison-losses.json"];
  assert.ok(charts && losses);
  const points = JSON.parse(charts).herodevs as Array<{ label: string; count: number }>;
  const rows = JSON.parse(losses) as Array<{ id: string; count: number }>;
  assert.equal(points.find((point) => point.label === "Agree")?.count, actual.known.agree);
  assert.equal(rows.find((row) => row.id === "herodevs")?.count, actual.known["hero-only"]);
});
