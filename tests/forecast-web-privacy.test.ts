import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { chromium } from "playwright";
import type { Page, Request } from "playwright";

const directory = "dist/forecast-web";
const app = "/offing/forecast-web/app/";
const types: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "app.js": "text/javascript",
  "style.css": "text/css",
};

async function dropLockfile(page: Page, contents: string): Promise<void> {
  const dataTransfer = await page.evaluateHandle((source) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([source], "package-lock.json", { type: "application/json" }));
    return transfer;
  }, contents);
  await page.locator("#drop-area").dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

async function assertPrivacy(requests: readonly Request[], allowed: ReadonlySet<string>, lock: string): Promise<void> {
  for (const request of requests) {
    assert.ok(allowed.has(request.url()), `Unexpected request: ${request.url()}`);
    assert.equal(request.method(), "GET");
    assert.equal(request.postData(), null);
    const headers = JSON.stringify(await request.headersArray());
    assert.ok(!headers.includes(lock.trim().slice(0, 64)));
    assert.ok(!headers.includes("@velella/offing"));
  }
}

async function serveForecast(t: TestContext) {
  const files = await readdir(directory);
  const data = files.find((file) => /^ebb-data-.*\.json$/.test(file));
  assert.ok(data);
  const assets = new Map<string, Buffer>(
    await Promise.all(files.map(async (file) => [`${app}${file}`, await readFile(join(directory, file))] as const)),
  );
  assets.set(app, await readFile(join(directory, "index.html")));
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const bytes = assets.get(path);
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", types[path.slice(app.length) || "index.html"] ?? "application/json");
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const allowed = new Set([...assets.keys()].map((path) => origin + path));
  const dataUrl = `${origin}${app}${data}`;

  return { origin, allowed, dataUrl, dataBytes: assets.get(app + data) };
}

test("forecast drop, clipboard and calendar stay local and modified data is rejected", {
  timeout: 60_000,
  skip: process.env.OFFING_FORECAST_BROWSER !== "1" && "Run the forecast-web browser check with Chromium installed.",
}, async (t) => {
  const { origin, allowed, dataUrl, dataBytes } = await serveForecast(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"], serviceWorkers: "block" });
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  await page.route("**/*", (route) => (allowed.has(route.request().url()) ? route.continue() : route.abort()));
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00Z"));
  await page.goto(origin + app);

  const lock = await readFile("package-lock.json", "utf8");
  const beforeDrop = requests.length;
  await dropLockfile(page, lock);
  await page.getByRole("heading", { name: "0–3 months" }).waitFor();
  assert.deepEqual(await page.locator("#buckets h3").allTextContents(), ["0–3 months", "3–6 months", "6–12 months"]);
  assert.match((await page.locator("#result-title").textContent()) ?? "", /Weather: (clear|cloudy|storm)/);
  assert.deepEqual(
    requests.slice(beforeDrop).map((request) => request.url()),
    [dataUrl],
  );

  await page.getByLabel("Or paste file contents").fill('{"dependencies":{"next":"15.0.0"}}');
  await page.getByRole("button", { name: "Run forecast", exact: true }).click();
  await page.getByRole("heading", { name: "Weather: storm" }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ics" }).click();
  const calendar = await download;
  assert.equal(calendar.suggestedFilename(), "offing-forecast.ics");
  assert.match(await readFile(await calendar.path(), "utf8"), /BEGIN:VEVENT\r\n[\s\S]*DTSTART;VALUE=DATE:20261021/);

  await page.getByRole("button", { name: "Copy summary" }).click();
  await page.getByText("Forecast copied.", { exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Weather: storm[\s\S]*2026-10-21/);
  assert.deepEqual(
    requests.slice(beforeDrop).map((request) => request.url()),
    [dataUrl],
  );
  await assertPrivacy(requests, allowed, lock);

  const corruptPage = await browser.newPage({ serviceWorkers: "block" });
  assert.ok(dataBytes);
  await corruptPage.route(dataUrl, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: Buffer.concat([dataBytes, Buffer.from(" ")]),
    }),
  );
  await corruptPage.goto(origin + app);
  await dropLockfile(corruptPage, lock);
  await corruptPage.getByText("The Ebb data signature could not be verified.", { exact: true }).waitFor();
  assert.equal(await corruptPage.locator("#results").isVisible(), false);
});

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function repositoryFile(path: string, contents: string) {
  const size = Buffer.byteLength(contents);
  const sha = createHash("sha1").update(`blob ${size}\0`).update(contents).digest("hex");
  return { path, size, sha, type: "blob", mode: "100644" };
}

test("acc-forecast-link browser requires consent and aborts a superseded fragment without leaking local input", {
  timeout: 60_000,
  skip: process.env.OFFING_FORECAST_BROWSER !== "1" && "Run the forecast-web browser check with Chromium installed.",
}, async (t) => {
  const { origin, allowed } = await serveForecast(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ serviceWorkers: "block" });
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00Z"));
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));

  const oldSelector = "github/example/first@feature%2Fforecast";
  const newSelector = `github/example/second@${"a".repeat(40)}`;
  const oldTree = "https://api.github.com/repos/example/first/git/trees/feature%2Fforecast?recursive=1";
  const oldRaw = "https://raw.githubusercontent.com/example/first/feature%2Fforecast/package.json";
  const oldNext = "https://raw.githubusercontent.com/example/first/feature%2Fforecast/vendor/package.json";
  const newTree = `https://api.github.com/repos/example/second/git/trees/${"a".repeat(40)}?recursive=1`;
  const newRaw = `https://raw.githubusercontent.com/example/second/${"a".repeat(40)}/`;
  const manifest = '{"dependencies":{"next":"15.0.0"}}';
  const firstStarted = gate();
  const releaseFirst = gate();
  t.after(releaseFirst.release);
  await page.route("**/*", async (route) => {
    const address = route.request().url();
    if (allowed.has(address)) return route.continue();
    const headers = { "Access-Control-Allow-Origin": origin };
    if (address === oldTree || address === newTree) {
      const entries =
        address === oldTree
          ? [repositoryFile("package.json", manifest), repositoryFile("vendor/package.json", manifest)]
          : [repositoryFile("package.json", manifest), repositoryFile("bad/package.json", "invalid JSON")];
      return route.fulfill({ headers, json: { truncated: false, tree: entries } });
    }
    if (address === oldRaw) {
      firstStarted.release();
      await releaseFirst.promise;
      return route.fulfill({ headers, body: manifest }).catch(() => undefined);
    }
    if (address === newRaw + "package.json") return route.fulfill({ headers, body: manifest });
    if (address === newRaw + "bad/package.json") return route.fulfill({ headers, body: "invalid JSON" });
    return route.abort();
  });

  await page.goto(`${origin}${app}#${oldSelector}`);
  const selector = page.getByLabel("Public GitHub repository", { exact: true });
  assert.equal(await selector.inputValue(), oldSelector);
  await page.getByText(/api\.github\.com.*raw\.githubusercontent\.com.*sent to Velella/).waitFor();
  const privatePaste = '{"dependencies":{"next":"15.0.0"},"private":"keep-this-repository-secret"}';
  await page.getByLabel("Or paste file contents").fill(privatePaste);
  await page.getByRole("button", { name: "Run forecast", exact: true }).click();
  await page.getByRole("heading", { name: "Weather: storm" }).waitFor();
  await assertPrivacy(requests, allowed, privatePaste);

  const fetchButton = page.getByRole("button", { name: "Fetch public files and run forecast" });
  await fetchButton.click();
  await firstStarted.promise;
  const stopped = page.waitForEvent("requestfailed", (request) => request.url() === oldRaw);
  await page.evaluate((value) => {
    location.hash = value;
  }, newSelector);
  assert.match((await stopped).failure()?.errorText ?? "", /ERR_ABORTED/);
  releaseFirst.release();
  await page.getByText("Repository fetch cancelled.", { exact: true }).waitFor();
  assert.equal(await selector.inputValue(), newSelector);
  assert.equal(await page.getByRole("button", { name: "Cancel fetch" }).isVisible(), false);
  assert.deepEqual(
    requests.filter((request) => !allowed.has(request.url())).map((request) => request.url()),
    [oldTree, oldRaw],
  );

  await fetchButton.click();
  await page.getByRole("heading", { name: "Weather: storm" }).waitFor();
  await page.getByText("Repository files · 1 read · 1 skipped", { exact: true }).click();
  await page.getByText("Read: package.json", { exact: true }).waitFor();
  await page.getByText("Skipped: bad/package.json — Unsupported or invalid file contents.", { exact: true }).waitFor();
  assert.deepEqual(
    requests.filter((request) => !allowed.has(request.url())).map((request) => request.url()),
    [oldTree, oldRaw, newTree, newRaw + "bad/package.json", newRaw + "package.json"],
  );
  assert.ok(!requests.some((request) => request.url() === oldNext));
  for (const request of requests.filter((request) => !allowed.has(request.url()))) {
    const headers = await request.allHeaders();
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers.referer, undefined);
  }
  await assertPrivacy(
    requests,
    new Set([...allowed, oldTree, oldRaw, newTree, newRaw + "bad/package.json", newRaw + "package.json"]),
    privatePaste,
  );
});
