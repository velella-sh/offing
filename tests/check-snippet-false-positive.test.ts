import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

const clean = [
  ["app.js", "// new Buffer(10)"],
  ["app.js", "/*\n new Buffer(10);\n */"],
  ["app.js", 'const example = "new Buffer(10)";'],
  ["app.ts", "const example = `new Buffer(10)`;"],
  ["app.ts", "const newBuffer = 10; const x = Buffer.from('hello');"],
  ["app.js", "const obj = { Buffer() {} }; obj.Buffer(3);"],
  ["app.js", "function demo(Buffer) { return new Buffer(10); }"],
  ["app.py", "# import imp"],
  ["app.py", "'''\nimport imp\nfrom datetime import datetime\ndatetime.utcnow()\n'''"],
  ["app.py", "example = 'imp.find_module(10)'"],
  ["app.py", "imp_version = '1'"],
  ["app.py", "from datetime import datetime\nexample = 'datetime.utcnow()'"],
  ["app.py", "from datetime import datetime\n# datetime.utcnow()"],
  ["deploy.yaml", "apiVersion: networking.k8s.io/v1\nkind: Ingress\n# apiVersion: extensions/v1beta1\n"],
  [
    ".github/workflows/ci.yml",
    "jobs:\n  t:\n    steps:\n      # - uses: actions/checkout@v2\n      - run: echo ok # ::set-output name=x::y\n",
  ],
] as const;

for (const [index, [path, content]] of clean.entries()) {
  test(`ignores lookalike ${index + 1} in ${path}`, async () => {
    assert.deepEqual((await checkSnippet({ path, content })).findings, []);
  });
}
