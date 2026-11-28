import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { renderDemoManifest, verifyDemoManifest } from "../tools/demo-manifest.js";

const root = resolve(import.meta.dirname, "../..");
const manifest = "docs/demos/manifest.json";

test("the recorded release manifest is deterministic and matches its tapes and media", async () => {
  const tracked = await readFile(join(root, manifest), "utf8");
  const version = JSON.parse(tracked).offingVersion;
  assert.equal(await renderDemoManifest(root, version), tracked);
  assert.equal(await renderDemoManifest(root, version), tracked);
  await verifyDemoManifest(root, version);
});

test("verification rejects a stale version, changed media, or changed tape", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "offing-demo-manifest-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const tracked = await readFile(join(root, manifest), "utf8");
  const version = JSON.parse(tracked).offingVersion;
  for (const directory of ["demos", "docs/assets/demos", "docs/demos"]) {
    const target = join(fixture, directory);
    await mkdir(target, { recursive: true });
    await cp(join(root, directory), target, { recursive: true });
  }

  await assert.rejects(verifyDemoManifest(fixture, "9.9.9"), /expected Offing version/);
  await appendFile(join(fixture, "docs/demos/guard.gif"), "changed");
  await assert.rejects(verifyDemoManifest(fixture), /manifest is stale/);

  await writeFile(join(fixture, manifest), await renderDemoManifest(fixture, version));
  await verifyDemoManifest(fixture, version);

  await appendFile(join(fixture, "demos/guard.tape"), "# updated\n");
  await assert.rejects(verifyDemoManifest(fixture), /manifest is stale/);
});
