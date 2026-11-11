// Guards every published documentation URL so a theme move or a deleted page cannot break a link.
//
//   node dist/tools/site-urls.js                   # prints the current URL inventory to stdout
//   node dist/tools/site-urls.js --out <file>      # writes the current URL inventory to <file>
//   node dist/tools/site-urls.js --check           # exits 1 when a URL has no file in docs/ or a baseline URL vanished without a redirect
//   node dist/tools/site-urls.js --update-baseline # rewrites the published-site baseline (release step)
//
// The baseline is a snapshot of the last published site, committed as tests/fixtures/site-urls.baseline.json.
// The current inventory is generated on demand, so a new page never edits a shared fixture: only a page
// that disappears needs a redirect (or a deliberate baseline refresh at release time).
//
// Sources: docs/sitemap.xml (or the registry render when it is gitignored) plus every page file under
// docs/ that Mizzen publishes. A page is served at its pretty URL (`MCP.md` is `/MCP/`) unless its front matter sets
// a `permalink` (rule and answer pages keep their `.html` addresses). Retired addresses live in the `redirects` map
// of docs/mizzen.yml. No network.

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

import { loadRegistries, renderSitemap } from "./build-reference-pages.js";

export const SITE_URL = "https://velella.sh/offing";
/** Snapshot of the URLs the published site serves, captured from the last release. */
export const BASELINE_PATH = "tests/fixtures/site-urls.baseline.json";

/** Config and data blobs under docs/ that are not published as pages. */
const SKIP_FILES = new Set(["mizzen.yml", "coverage-descriptions.json", "differential-report.json"]);
/** Asset trees and local build output, walked by the page scan. */
const SKIP_DIRECTORIES = new Set(["assets", "vendor", "_site"]);
/** Pages that docs/mizzen.yml excludes: repository notes, not site pages. */
const EXCLUDED_PAGES = new Set(["dashboard/README.md"]);
/** The Mizzen config, relative to the repository root. */
export const SITE_CONFIG_PATH = "docs/mizzen.yml";
/**
 * Docs-relative paths the Pages workflow generates before Mizzen builds. They are gitignored, so a
 * fresh checkout has no on-disk copy, but the public URL stays in the inventory and baseline.
 */
export const BUILD_TIME_DOCS_FILES = ["llms-full.txt", "sitemap.xml", "rules/index.md"] as const;
/** Machine files at the site root that Pages generates (subset of BUILD_TIME_DOCS_FILES). */
export const BUILD_TIME_MACHINE_FILES = ["llms-full.txt", "sitemap.xml"] as const;

export function parseSitemapUrls(sitemap: string): string[] {
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
}

/** Sitemap text from disk, or rendered from the registry when the file is gitignored. */
export async function readSitemapText(root = "."): Promise<string> {
  const path = join(resolve(root, "docs"), "sitemap.xml");
  try {
    return await readFile(path, "utf8");
  } catch {
    return renderSitemap(await loadRegistries(join(resolve(root), "node_modules/@velella/ebb/registry")));
  }
}

/** The address a page's front matter `permalink` names, under the site URL. */
function permalinkUrl(permalink: string): string {
  return `${SITE_URL}${permalink.startsWith("/") ? "" : "/"}${permalink}`;
}

/**
 * Public URL for a path relative to docs/, or undefined when the file is not a page. `permalink` is the page's
 * front matter value, which wins over the path.
 */
export function urlForDocsPath(relativePath: string, permalink?: string): string | undefined {
  const path = relativePath.replaceAll("\\", "/");
  if (path.endsWith(".md") && permalink !== undefined && permalink !== "") return permalinkUrl(permalink);
  if (path === "index.md" || path === "README.md" || path === "index.html") return `${SITE_URL}/`;
  for (const name of ["index.md", "README.md", "index.html"]) {
    if (path.endsWith(`/${name}`)) return `${SITE_URL}/${path.slice(0, -name.length)}`;
  }
  if (path.endsWith(".md")) return `${SITE_URL}/${path.slice(0, -".md".length)}/`;
  if (path.endsWith(".html")) return `${SITE_URL}/${path}`;
  if (path.endsWith(".txt") || path.endsWith(".xml")) return `${SITE_URL}/${path}`;
  return undefined;
}

/** Candidate docs/ paths that would publish as `url`. */
export function docsPathsForUrl(url: string): string[] {
  const prefix = `${SITE_URL}/`;
  if (url !== `${SITE_URL}/` && !url.startsWith(prefix)) return [];
  const path = url === `${SITE_URL}/` ? "" : url.slice(prefix.length);
  if (path === "") return ["index.md", "index.html"];
  if (path.endsWith("/")) {
    const directory = path.slice(0, -1);
    return [`${path}index.md`, `${path}README.md`, `${path}index.html`, `${directory}.md`];
  }
  if (path.endsWith(".html")) return [`${path.slice(0, -".html".length)}.md`, path];
  return [path];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** One named field of a parsed YAML document, or undefined when the document is not a mapping. */
function field(document: unknown, name: string): unknown {
  if (typeof document !== "object" || document === null) return undefined;
  return Object.entries(document).find(([key]) => key === name)?.[1];
}

/** The `permalink` in a Markdown page's front matter, when it sets one. */
async function readPermalink(file: string): Promise<string | undefined> {
  const frontMatter = (await readFile(file, "utf8")).match(FRONT_MATTER)?.[1];
  if (frontMatter === undefined) return undefined;
  const value = field(parse(frontMatter), "permalink");
  return typeof value === "string" ? value : undefined;
}

async function listPageFiles(docsRoot: string, base = ""): Promise<string[]> {
  const entries = await readdir(join(docsRoot, base), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await listPageFiles(docsRoot, relative)));
      continue;
    }
    if (entry.name.startsWith("_") || SKIP_FILES.has(entry.name) || EXCLUDED_PAGES.has(relative)) continue;
    if (urlForDocsPath(relative) !== undefined) files.push(relative);
  }
  return files;
}

/** Union of sitemap locations and every page under docs/, sorted. */
export async function collectSiteUrls(root = "."): Promise<string[]> {
  const docsRoot = resolve(root, "docs");
  const urls = new Set<string>(parseSitemapUrls(await readSitemapText(root)));
  for (const file of await listPageFiles(docsRoot)) {
    const url = urlForDocsPath(file, file.endsWith(".md") ? await readPermalink(join(docsRoot, file)) : undefined);
    if (url !== undefined) urls.add(url);
  }
  for (const file of BUILD_TIME_DOCS_FILES) {
    const url = urlForDocsPath(file);
    if (url !== undefined) urls.add(url);
  }
  return [...urls].sort((left, right) => left.localeCompare(right));
}

export function renderInventory(urls: readonly string[]): string {
  return `${JSON.stringify(urls, null, 2)}\n`;
}

/** Inventory URLs that have no matching file under docs/. */
export async function missingFromSite(urls: readonly string[], root = "."): Promise<string[]> {
  const docsRoot = resolve(root, "docs");
  const buildTime = new Set(BUILD_TIME_DOCS_FILES.map((file) => urlForDocsPath(file)));
  const missing: string[] = [];
  for (const url of urls) {
    if (buildTime.has(url)) continue;
    let found = false;
    for (const candidate of docsPathsForUrl(url)) {
      try {
        await access(join(docsRoot, candidate));
        found = true;
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!found) missing.push(url);
  }
  return missing;
}

/** Absolute URL for a `redirects` key, which is a path under the site's base. */
function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Every address docs/mizzen.yml keeps serving as a redirect page: the keys of its `redirects` map. */
export async function redirectedUrls(root = "."): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(resolve(root, SITE_CONFIG_PATH), "utf8");
  } catch {
    return [];
  }
  const redirects = field(parse(text), "redirects");
  const keys = typeof redirects === "object" && redirects !== null ? Object.keys(redirects) : [];
  return keys.map(absoluteUrl).sort((left, right) => left.localeCompare(right));
}

/** Baseline URLs the current inventory no longer publishes and no redirect covers. */
export async function lostUrls(baseline: readonly string[], current: readonly string[], root = "."): Promise<string[]> {
  const redirected = new Set(await redirectedUrls(root));
  const published = new Set(current);
  return baseline.filter((url) => !published.has(url) && !redirected.has(url));
}

/** The published-site baseline committed at tests/fixtures/site-urls.baseline.json. */
export async function readBaseline(root = "."): Promise<string[]> {
  const path = resolve(root, BASELINE_PATH);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.some((url) => typeof url !== "string")) {
    throw new Error(`${BASELINE_PATH} must be a JSON array of URLs`);
  }
  return parsed;
}

export const USAGE = "usage: node dist/tools/site-urls.js [--out <file> | --check | --update-baseline]";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const urls = await collectSiteUrls();
  const text = renderInventory(urls);

  if (argv.includes("--check")) {
    const baseline = await readBaseline();
    const missing = await missingFromSite(urls);
    const lost = await lostUrls(baseline, urls);
    if (missing.length === 0 && lost.length === 0) {
      console.log(`${urls.length} published URLs; all ${baseline.length} baseline URLs are still served.`);
      return 0;
    }
    for (const url of missing) console.error(`missing from docs/: ${url}`);
    for (const url of lost) {
      console.error(`URL disappeared without a redirect: ${url}`);
      console.error(
        `  Restore the page, add a redirect (the "redirects" map in ${SITE_CONFIG_PATH}), or refresh ${BASELINE_PATH} at release time with --update-baseline.`,
      );
    }
    return 1;
  }

  if (argv.includes("--update-baseline")) {
    const lost = await lostUrls(await readBaseline(), urls);
    if (lost.length > 0) {
      for (const url of lost) console.error(`refusing to drop ${url} without a redirect`);
      return 1;
    }
    const target = resolve(BASELINE_PATH);
    await writeFile(target, text);
    console.log(`Wrote ${target} (${urls.length} URLs).`);
    return 0;
  }

  const outIndex = argv.indexOf("--out");
  if (outIndex !== -1) {
    const value = argv[outIndex + 1];
    if (value === undefined) {
      console.error(USAGE);
      return 2;
    }
    const target = resolve(value);
    await writeFile(target, text);
    console.log(`Wrote ${target} (${urls.length} URLs).`);
    return 0;
  }

  if (argv.length > 0) {
    console.error(USAGE);
    return 2;
  }
  process.stdout.write(text);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
