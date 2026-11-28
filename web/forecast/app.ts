import { forecastWeather, renderForecastText } from "../../src/forecast-core.js";
import type { RepositoryForecast } from "../../src/forecast-core.js";
import { calendarRecord, maxInputBytes, prepareGitHubForecast } from "../../src/forecast-tool/records.js";
import { repositoryNetworkNotice } from "../../src/forecast-tool/remote/github.js";
import { parseGitHubForecastInput } from "../../src/forecast-tool/remote/input.js";
import { loadData } from "./data.js";
import { createReport } from "../../src/forecast-tool/report.js";

type RepositorySources = NonNullable<Awaited<ReturnType<typeof prepareGitHubForecast>>>["repository"];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing page element ${id}.`);
  return found as T;
}

const form = element<HTMLFormElement>("forecast-form");
const fileInput = element<HTMLInputElement>("file");
const contents = element<HTMLTextAreaElement>("contents");
const dropArea = element("drop-area");
const status = element("status");
const results = element("results");
const exportStatus = element("export-status");
const repositoryInput = element<HTMLInputElement>("repository");
const cancelFetch = element<HTMLButtonElement>("cancel-fetch");
const repositoryFiles = element("repository-files");

let active: ReturnType<typeof createReport> | undefined;
let runId = 0;
let repositoryRequest: AbortController | undefined;

function textElement(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function renderBuckets(forecast: RepositoryForecast, subject: string): void {
  const panels = forecast.buckets.map((bucket) => {
    const affecting = bucket.events;
    const panel = document.createElement("section");
    const heading = textElement("h3", bucket.label.replace("-", "–"));
    const count = textElement(
      "p",
      `${affecting.length} for this ${subject} · ${bucket.total - affecting.length} elsewhere`,
    );
    count.className = "bucket-count";
    panel.append(heading, count);
    if (affecting.length === 0) return panel;
    const list = document.createElement("ul");
    for (const event of affecting) {
      const item = document.createElement("li");
      const date = document.createElement("time");
      date.dateTime = event.date;
      date.textContent = event.date;
      item.append(date, document.createTextNode(`${event.title} (${event.severity})`));
      list.append(item);
    }
    panel.append(list);
    return panel;
  });
  const near = forecast.buckets[0]?.events ?? [];
  element("result-title").textContent = `Weather: ${forecastWeather(near, forecast.noData.length > 0)}`;
  element("buckets").replaceChildren(...panels);
}

function renderRepositorySources(sources: RepositorySources): void {
  const displayed = [
    ...sources.read.map((path) => textElement("li", `Read: ${path}`)),
    ...sources.skipped.map(({ path, reason }) => textElement("li", `Skipped: ${path} — ${reason}`)),
  ];
  if (sources.omitted) displayed.push(textElement("li", `${sources.omitted} more skipped paths.`));
  element("repository-files-title").textContent =
    `Repository files · ${sources.read.length} read · ${sources.skipped.length + sources.omitted} skipped`;
  element("repository-files-list").replaceChildren(...displayed);
  repositoryFiles.hidden = false;
}

function renderReport(report: ReturnType<typeof createReport>, dataVersion: string, sources?: RepositorySources): void {
  const { forecast, checked } = report;
  const subject = sources ? "repository" : "file";
  renderBuckets(forecast, subject);
  if (sources) renderRepositorySources(sources);
  element("period").textContent = `${forecast.today} to ${forecast.until} · Ebb data ${dataVersion}`;
  const gaps = forecast.noData;
  element("unclassified").hidden = gaps.length === 0;
  element("unclassified-title").textContent = `No data for ${gaps.length} reference${gaps.length === 1 ? "" : "s"}`;
  const rows = document.createDocumentFragment();
  for (const { reference, reason } of gaps) rows.append(textElement("li", `${reference} — ${reason}`));
  element("unclassified-list").replaceChildren(rows);
  status.textContent = checked === 0 ? `No supported declarations found in this ${subject}.` : "";
  results.hidden = false;
}

function finishRepositoryRequest(): void {
  repositoryRequest = undefined;
  cancelFetch.hidden = true;
}

function cancelRepositoryRequest(): void {
  if (!repositoryRequest) return;
  repositoryRequest.abort();
  finishRepositoryRequest();
  status.textContent = "Repository fetch cancelled.";
}

function startRun(): number {
  cancelRepositoryRequest();
  active = undefined;
  results.hidden = true;
  repositoryFiles.hidden = true;
  exportStatus.textContent = "";
  return ++runId;
}

async function run(file?: File): Promise<void> {
  const current = startRun();
  const pasted = contents.value;
  try {
    if (!file && !pasted.trim()) throw new Error("Choose a file or paste its contents.");
    const size = file?.size ?? new TextEncoder().encode(pasted).byteLength;
    if (size > maxInputBytes) throw new Error("Choose a file or paste up to 5 MiB.");
    status.textContent = "Preparing forecast…";
    const data = await loadData();
    const input = file ? await file.text() : pasted;
    if (current !== runId) return;
    active = createReport(input, data, new Date().toISOString().slice(0, 10), file?.name);
    renderReport(active, data.version);
  } catch (error) {
    if (current === runId) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function runRepository(): Promise<void> {
  startRun();
  const request = new AbortController();
  try {
    const value = repositoryInput.value.trim();
    parseGitHubForecastInput(value);
    const url = new URL(location.href);
    url.hash = value;
    history.replaceState(history.state, "", url);
    repositoryRequest = request;
    cancelFetch.hidden = false;
    status.textContent = "Fetching public GitHub files…";
    const forecast = await prepareGitHubForecast(
      value,
      fetch,
      loadData,
      new Date().toISOString().slice(0, 10),
      request.signal,
    );
    if (repositoryRequest !== request) return;
    if (!forecast) {
      status.textContent = "No supported repository files found.";
      return;
    }
    active = forecast.report;
    renderReport(active, forecast.dataVersion, forecast.repository);
  } catch (error) {
    if (!request.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (repositoryRequest === request) finishRepositoryRequest();
  }
}

function readFragment(): void {
  cancelRepositoryRequest();
  repositoryInput.value = location.hash.slice(1);
}

element("network-notice").textContent = repositoryNetworkNotice;
element<HTMLFormElement>("repository-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void runRepository();
});
repositoryInput.addEventListener("input", cancelRepositoryRequest);
cancelFetch.addEventListener("click", cancelRepositoryRequest);
window.addEventListener("hashchange", readFragment);
readFragment();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void run();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void run(file);
});
dropArea.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropArea.setAttribute("data-active", "");
});
dropArea.addEventListener("dragleave", () => dropArea.removeAttribute("data-active"));
dropArea.addEventListener("drop", (event) => {
  event.preventDefault();
  dropArea.removeAttribute("data-active");
  const file = event.dataTransfer?.files[0];
  if (file) void run(file);
});
element("calendar").addEventListener("click", () => {
  if (!active) return;
  const { content, mediaType, name } = calendarRecord(active);
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
element("copy").addEventListener("click", async () => {
  if (!active) return;
  try {
    await navigator.clipboard.writeText(renderForecastText(active.forecast));
    exportStatus.textContent = "Forecast copied.";
  } catch {
    exportStatus.textContent = "Clipboard access failed. Check this page’s clipboard permission.";
  }
});
