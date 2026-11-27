const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { test } = require("node:test");

test("clean sandbox", () => {
  assert.equal(process.cwd(), "/work/tree");
  assert.equal(process.env.HOME, "/tmp");
  assert.equal(process.env.OFFING_FIXTURE_PARENT_SECRET, undefined);
  assert.equal(existsSync(".git"), false);
});

test("intermittent example", () => {
  assert.equal(process.env.OFFING_TEST_ATTEMPT, "2", "controlled first-attempt failure");
});
