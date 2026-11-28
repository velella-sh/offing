import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { checkDemoCaptions, renderTapeCaptions, writeDemoCaptions } from "../tools/demo-captions.js";
import { captionFiles, renderDemoManifest, verifyDemoManifest } from "../tools/demo-manifest.js";

const root = resolve(import.meta.dirname, "../..");
const manifest = "docs/demos/manifest.json";

test("the recorded release manifest is deterministic and matches its tapes and media", async () => {
  const tracked = await readFile(join(root, manifest), "utf8");
  const version = JSON.parse(tracked).offingVersion;
  assert.equal(await renderDemoManifest(root, version), tracked);
  assert.equal(await renderDemoManifest(root, version), tracked);
  await verifyDemoManifest(root, version);
});

async function demoFixture(t: TestContext): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "offing-demo-manifest-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  for (const directory of ["demos", "docs/assets/demos", "docs/demos"]) {
    const target = join(fixture, directory);
    await mkdir(target, { recursive: true });
    await cp(join(root, directory), target, { recursive: true });
  }
  return fixture;
}

test("acc-demo-tapes checks untracked, missing, changed, and oversized media in both directories", async (t) => {
  const fixture = await demoFixture(t);
  const tracked = await readFile(join(root, manifest), "utf8");
  const version = JSON.parse(tracked).offingVersion;
  await assert.rejects(verifyDemoManifest(fixture, "9.9.9"), /recorded .+, expected 9\.9\.9/u);
  for (const directory of ["docs/demos", "docs/assets/demos"]) {
    const untracked = `${directory}/unexpected.gif`;
    await writeFile(join(fixture, untracked), "synthetic untracked asset");
    await assert.rejects(verifyDemoManifest(fixture, version), Error(`Untracked demo media: ${untracked}.`));
    await rm(join(fixture, untracked));

    const path = `${directory}/forecast.gif`;
    const local = join(fixture, path);
    await rm(local);
    await assert.rejects(verifyDemoManifest(fixture, version), Error(`Missing demo media: ${path}.`));
    await cp(join(root, path), local);
    await appendFile(local, "changed");
    await assert.rejects(
      verifyDemoManifest(fixture, version),
      Error(`Demo manifest is stale. Changed files: ${path}.`),
    );
    await writeFile(local, Buffer.alloc(3_000_000));
    await assert.rejects(verifyDemoManifest(fixture, version), /GIF must be smaller than 3 MB/u);
    await cp(join(root, path), local);
  }

  const archived = "docs/assets/demos/check.gif";
  await appendFile(join(fixture, archived), "changed historical capture");
  await assert.rejects(renderDemoManifest(fixture, version), /Supplemental media differs from its recorded source/u);
  await cp(join(root, archived), join(fixture, archived));

  await appendFile(join(fixture, "demos/guard.tape"), "# updated\n");
  await assert.rejects(verifyDemoManifest(fixture, version), /Changed files: demos\/guard\.tape/u);
  await writeFile(join(fixture, manifest), await renderDemoManifest(fixture, version));
  await verifyDemoManifest(fixture, version);
});

test("acc-demo-tapes reproducibly generates exact captions and rejects changed cues", async (t) => {
  await checkDemoCaptions(root, captionFiles);
  const fixture = await demoFixture(t);
  await appendFile(join(fixture, "docs/demos/guard.srt"), "stale caption");
  await assert.rejects(checkDemoCaptions(fixture, captionFiles), /docs\/demos\/guard\.srt/u);
  await writeDemoCaptions(fixture, captionFiles);
  await checkDemoCaptions(fixture, captionFiles);
  for (const { output } of captionFiles) {
    assert.deepEqual(await readFile(join(fixture, output)), await readFile(join(root, output)));
  }
  assert.throws(
    () => renderTapeCaptions("# Caption 00:00:02,000 --> 00:00:01,000\n# | Invalid reverse cue\n"),
    /Invalid caption cue 1/u,
  );
});
