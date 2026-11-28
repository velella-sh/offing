import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { assertCurrentBrand } from "./public-brand.js";

async function checkLaunchPosts(directory: string): Promise<void> {
  const posts = (await readdir(directory, { recursive: true })).filter((name) => name.endsWith(".md"));
  assert.ok(posts.length, "Expected at least one launch Markdown file");
  for (const post of posts) {
    assertCurrentBrand(await readFile(join(directory, post), "utf8"), post);
  }
}

test("launch posts and their supporting Markdown use the current project name", async () => {
  await checkLaunchPosts(resolve(import.meta.dirname, "../../docs/launch"));
});

test("the launch post check rejects the retired project name in a nested draft", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "offing-launch-posts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outlet = join(directory, "outlet");
  await mkdir(outlet);
  await writeFile(join(outlet, "draft.md"), "# SeAwOrThY\n");
  await assert.rejects(checkLaunchPosts(directory), /draft\.md uses the retired project name/u);
});
