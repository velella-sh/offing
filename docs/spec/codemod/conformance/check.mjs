// Run with Node and the installed Offing executable or its JavaScript entry point.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [executable, ...leading] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node check.mjs <offing executable> [leading command arguments]");
const root = mkdtempSync(join(tmpdir(), "acc-codemod-kit-"));
const specimen = fileURLToPath(new URL("../example/", import.meta.url));
const run = (...args) =>
  execFileSync(executable, [...leading, "codemod", "test", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OFFING_DATA_VERSION: "bundled" },
  });
try {
  const fixture = join(root, "example");
  cpSync(specimen, fixture, { recursive: true });
  const expected = "mise-node-pin: passed 2 case(s) (applies, refuses).";
  const output = run(fixture).trim();
  if (output !== expected) throw new Error(`Unexpected conformance result: ${output}`);
  const path = join(fixture, "codemod.json");
  const declaration = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...declaration, expectedReplacement: "Outdated replacement" }));
  let refused = false;
  try {
    run(fixture);
  } catch (error) {
    if (error.status !== 1 || !error.stderr.includes("The rule no longer names the replacement")) throw error;
    refused = true;
  }
  if (!refused) throw new Error("The installed CLI accepted an outdated replacement.");
  process.stdout.write(`acc-codemod-kit: ${output} Rule drift was refused.\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
