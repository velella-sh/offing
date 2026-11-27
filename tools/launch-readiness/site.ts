import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseSitemapUrls, SITE_URL } from "../site-urls.js";
import { publicGet } from "./evidence.js";

export const sitemapUrl = `${SITE_URL}/sitemap.xml`;
const pageRoot = new URL(`${SITE_URL}/`);
const maximumPages = 2_000;
const batchSize = 8;

function pagePath(address: string): string {
  const url = new URL(address);
  if (url.origin !== pageRoot.origin || url.href !== address) throw new Error("Invalid sitemap origin or URL.");
  if (url.username || url.password || url.search || url.hash || !url.pathname.startsWith(pageRoot.pathname)) {
    throw new Error("Invalid sitemap page address.");
  }
  const relative = url.pathname.slice(pageRoot.pathname.length);
  if (!/^[A-Za-z0-9._/-]*$/.test(relative) || relative.startsWith("/")) throw new Error("Invalid sitemap page path.");
  return url.pathname.endsWith("/") ? `${relative}index.html` : relative;
}

function sitemapEntries(text: string): string[] {
  if (!text.includes("</urlset>")) throw new Error("The sitemap is incomplete.");
  const pages = parseSitemapUrls(text);
  if (!pages.length || pages.length > maximumPages || new Set(pages).size !== pages.length) {
    throw new Error("Invalid sitemap page count.");
  }
  for (const page of pages) pagePath(page);
  return pages.sort();
}

async function responsePrefix(response: Response, bytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (bytes > 0) {
      const entry = await reader.read();
      if (entry.done) break;
      const chunk = entry.value.subarray(0, bytes);
      text += decoder.decode(chunk, { stream: true });
      bytes -= chunk.length;
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function title(html: string): string | undefined {
  return /<title(?:\s+[^>]*)?>([^<]*)<\/title\s*>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

type PageIssue = { address: string; kind: "mismatch" | "unavailable"; detail: string };

async function requestPage(fetcher: typeof fetch, address: string, deadline: AbortSignal): Promise<Response> {
  const response = await publicGet(fetcher, address, "text/html", deadline);
  if (response.status !== 502 && response.status !== 503 && response.status !== 504) return response;
  await response.body?.cancel();
  await setTimeout(250, undefined, { signal: deadline });
  return publicGet(fetcher, address, "text/html", deadline);
}

async function checkPage(
  address: string,
  directory: string,
  fetcher: typeof fetch,
  deadline: AbortSignal,
): Promise<PageIssue | undefined> {
  if (deadline.aborted) return { address, kind: "unavailable", detail: "Public site check timed out" };
  const expected = title(await readFile(join(directory, pagePath(address)), "utf8").catch(() => ""));
  if (!expected) return { address, kind: "unavailable", detail: "Built page title unavailable" };
  try {
    const response = await requestPage(fetcher, address, deadline);
    if (response.status !== 200) {
      await response.body?.cancel();
      return { address, kind: "mismatch", detail: `HTTP ${response.status}` };
    }
    if (title(await responsePrefix(response, 64 * 1024)) !== expected) {
      return { address, kind: "mismatch", detail: "Published title differs from build" };
    }
    return undefined;
  } catch {
    return { address, kind: "unavailable", detail: "Public page could not be read" };
  }
}

export async function checkSitemap(directory: string, fetcher: typeof fetch) {
  const deadline = AbortSignal.timeout(120_000);
  const expected = sitemapEntries(await readFile(join(directory, "sitemap.xml"), "utf8"));
  const live = await publicGet(fetcher, sitemapUrl, "application/xml,text/xml", deadline);
  if (live.status !== 200) {
    await live.body?.cancel();
    throw new Error(`Public sitemap returned HTTP ${live.status}.`);
  }
  const published = sitemapEntries(await responsePrefix(live, 512 * 1024));
  if (published.join("\n") !== expected.join("\n")) throw new Error("Build and public sitemap inventories differ.");
  const issues: PageIssue[] = [];
  for (let offset = 0; offset < published.length; offset += batchSize) {
    const batch = await Promise.all(
      published.slice(offset, offset + batchSize).map((url) => checkPage(url, directory, fetcher, deadline)),
    );
    for (const issue of batch) if (issue) issues.push(issue);
  }
  return { pages: published.length, issues };
}
