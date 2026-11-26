import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const ALLOWED_HTML_FILES = new Set(["google9538d3c74177f12b.html"]);
const SKIP_DIRECTORIES = new Set(["_site", "vendor", ".mizzen"]);
const FORBIDDEN_EXTENSIONS = [".html", ".css", ".js"] as const;

export async function findUnexpectedDocAssets(docsRoot: string, base = ""): Promise<string[]> {
  const unexpected: string[] = [];
  const entries = await readdir(join(docsRoot, base), { withFileTypes: true });
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      unexpected.push(...(await findUnexpectedDocAssets(docsRoot, relative)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (FORBIDDEN_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !ALLOWED_HTML_FILES.has(relative)) {
      unexpected.push(relative);
    }
  }
  return unexpected.sort((left, right) => left.localeCompare(right));
}

const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test("docs/ contains no .html, .css, or .js files other than the domain verification file", async () => {
  assert.deepEqual(await findUnexpectedDocAssets(resolve("docs")), []);
});

test("findUnexpectedDocAssets allows the domain verification file and flags unexpected HTML, CSS, and JS assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "offing-doc-assets-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "assets/css"), { recursive: true });
  await mkdir(join(root, "_site"), { recursive: true });
  await writeFile(join(root, "google9538d3c74177f12b.html"), "google-site-verification: ok\n");
  await writeFile(join(root, "_site/index.html"), "<!doctype html>\n");
  assert.deepEqual(await findUnexpectedDocAssets(root), []);

  await writeFile(join(root, "lookup.html"), "<!doctype html>\n");
  await writeFile(join(root, "assets/css/custom.css"), "body {}\n");
  await writeFile(join(root, "app.js"), "console.log(1);\n");
  assert.deepEqual(await findUnexpectedDocAssets(root), ["app.js", "assets/css/custom.css", "lookup.html"]);
});
