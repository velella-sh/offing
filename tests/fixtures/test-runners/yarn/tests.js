const assert = require("node:assert/strict");
const { test } = require("node:test");

test("passing example", () => assert.equal(2 + 2, 4));
test("failing example", () => assert.equal(2 + 2, 5));
