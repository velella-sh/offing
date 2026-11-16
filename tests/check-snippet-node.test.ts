import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

test("checks standalone Node.js API usage with evidence from Ebb", async () => {
  const cases = [
    ["new Buffer(8);", "buffer.constructor", "Buffer.alloc"],
    ["crypto.createCipher('aes-128-cbc', password);", "crypto.createcipher", "crypto.createCipheriv"],
    ["fs.exists('/somewhere', callback);", "fs.exists", "fs.stat"],
    ["util.isArray([]);", "util.isarray", "Array.isArray"],
    ["util.isString(value);", "util.isstring", "typeof"],
    ["util.isBoolean(value);", "util.isboolean", "typeof"],
    ["util.isDate(value);", "util.isdate", "instanceof Date"],
    ["os.getNetworkInterfaces();", "os.getnetworkinterfaces", "os.networkInterfaces"],
  ];
  const content = [
    "import * as crypto from 'node:crypto';",
    "import * as fs from 'node:fs';",
    "import * as util from 'node:util';",
    "import * as os from 'node:os';",
    ...cases.map(([code]) => code),
  ].join("\n");
  const { findings } = await checkSnippet({ path: "src/app.ts", content });
  for (const [index, [code, rule, replacement]] of cases.entries()) {
    const found = findings.find((finding) => finding.ruleId === `nodejs.symbol.${rule}`);
    assert.ok(found, rule);
    assert.equal(found.code, code);
    assert.ok(replacement && found.replacement?.includes(replacement));
    assert.deepEqual(found.source, found.sources[0]);
    assert.equal(found.location.line, index + 5);
  }
});
