import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { observeNpmTiming, underFirstMinuteBudget, type ColdTiming } from "../benchmarks/first-minute.js";

test("measurements use real tarball misses and the encompassing npm reify phase", () => {
  assert.deepEqual(
    observeNpmTiming("npm http fetch GET 200 https://registry.npmjs.org/a/-/a-1.2.3.tgz 30ms (cache miss)", 150),
    { download: { start: 120, end: 150 } },
  );
  assert.deepEqual(observeNpmTiming("npm timing reify Completed in 450ms", 510), { reifyMs: 450 });
  assert.deepEqual(observeNpmTiming("npm http fetch GET 200 https://registry.npmjs.org/a 30ms (cache miss)", 150), {});
  assert.deepEqual(observeNpmTiming("npm timing reify:unpack Completed in 250ms", 510), {});
});

test("the first forecast must arrive below 10 seconds with successful cold evidence", () => {
  const row: ColdTiming = {
    repository: "fixture",
    firstOutputMs: 9_999,
    downloadSpanMs: 200,
    npmReifyMs: 300,
    afterReifyMs: 50,
    tarballsFetched: 2,
    exitCode: 0,
  };
  assert.equal(underFirstMinuteBudget(row), true);
  assert.equal(underFirstMinuteBudget({ ...row, firstOutputMs: 10_000 }), false);
  assert.equal(underFirstMinuteBudget({ ...row, firstOutputMs: null }), false);
  assert.equal(underFirstMinuteBudget({ ...row, downloadSpanMs: null }), false);
  assert.equal(underFirstMinuteBudget({ ...row, npmReifyMs: null }), false);
  assert.equal(underFirstMinuteBudget({ ...row, error: "cold npm failed" }), false);
  assert.equal(underFirstMinuteBudget({ ...row, exitCode: 1 }), false);
});

test("npm publication needs a passing cold first-minute matrix for the exact candidate", async () => {
  const { jobs } = parse(await readFile(".github/workflows/release.yml", "utf8")) as {
    jobs: Record<string, { needs?: string[]; if?: string; with?: { candidate?: boolean } }>;
  };
  const measure = jobs["first-minute"];
  assert.deepEqual(measure?.needs, ["npm-candidate"]);
  assert.match(measure?.if ?? "", /needs\.npm-candidate\.result == 'success'/);
  assert.doesNotMatch(measure?.if ?? "", /dry_run/);
  assert.equal(measure?.with?.candidate, true);
  assert.deepEqual(jobs["npm-publish"]?.needs, ["first-minute"]);
  assert.match(jobs["npm-publish"]?.if ?? "", /needs\.first-minute\.result == 'success'/);
});
