import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

test("checks standalone Python imports and calls without executing them", async () => {
  const cases = [
    ["import imp", "module.imp.removed", "importlib"],
    ["imp.find_module('m')", "symbol.imp.find-module", "importlib.util.find_spec()"],
    ["imp.get_magic()", "symbol.imp.get-magic", "importlib.util.MAGIC_NUMBER"],
    ["imp.new_module(name)", "symbol.imp.new-module", "types.ModuleType(name)"],
    ["imp.reload(module)", "symbol.imp.reload", "importlib.reload()"],
    ["datetime.utcnow()", "symbol.datetime.utcnow", "datetime.now(datetime.UTC)"],
    [
      "datetime.utcfromtimestamp(0)",
      "symbol.datetime.utcfromtimestamp",
      "datetime.fromtimestamp(timestamp, datetime.UTC)",
    ],
    ["platform.java_ver()", "symbol.platform.java-ver", null],
  ] as const;
  const { findings } = await checkSnippet({
    path: "src/app.py",
    content: ["from datetime import datetime", "import platform", ...cases.map(([code]) => code)].join("\n"),
  });
  for (const [code, rule, replacement] of cases) {
    const found = findings.find((finding) => finding.ruleId === `python.${rule}`);
    assert.ok(found, rule);
    assert.equal(found.code, code);
    assert.equal(found.replacement, replacement);
    assert.deepEqual(found.source, found.sources[0]);
  }
});
