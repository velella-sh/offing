import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const [command, ...commandArgs] = process.argv.slice(2);
assert(command, "Usage: node check.mjs <implementation command> [arguments]");
const vectors = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "offing-fleet-policy-conformance-"));
const repository = join(scratch, "repository");
const call = (args) => run(command, [...commandArgs, "policy", ...args], { cwd: repository, timeout: 10_000 });
const document = (verdict) => JSON.stringify(verdict, null, 2);
try {
  await mkdir(repository);
  for (const vector of vectors) {
    await writeFile(join(repository, "org.json"), document(vector.organization));
    await writeFile(join(repository, ".offing.json"), document({ extends: "org.json", policy: vector.repository }));
    const date = ["--today", "2030-01-01"];
    if (vector.error) {
      await assert.rejects(call(["validate", ...date]), (error) => {
        assert(String(error.stderr).includes(vector.error), vector.name);
        return true;
      });
      continue;
    }
    await call(["validate", ...date]);
    if (vector.rule) {
      const { stdout } = await call(["explain", vector.rule, ...date]);
      for (const expected of vector.expected) assert(stdout.includes(expected), `${vector.name}: ${expected}`);
    }
  }
  console.log(`acc-fleet-policy: ${vectors.length} merge and validation vectors passed`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
