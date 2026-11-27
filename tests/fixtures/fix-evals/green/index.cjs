const assert = require("node:assert/strict");
assert.equal(process.cwd(), "/work/tree");
assert.equal(process.env.HOME, "/tmp");
assert.equal(process.env.GITHUB_ACTIONS, undefined);
assert.equal(new Buffer("lifecycle").toString("utf8"), "lifecycle");
