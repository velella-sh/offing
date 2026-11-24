import { forecastWeather, renderForecastText } from "../../src/forecast-core.js";
import type { RepositoryForecast } from "../../src/forecast-core.js";
import { renderForecastIcs } from "../../src/forecast-ics.js";
import { loadData } from "./data.js";
import { createReport } from "./report.js";

const maxBytes = 5 * 1024 * 1024;

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

let active: ReturnType<typeof createReport> | undefined;
let runId = 0;

function textElement(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function renderBuckets(forecast: RepositoryForecast): void {
  const panels = forecast.buckets.map((bucket) => {
    const affecting = bucket.events;
    const panel = document.createElement("section");
    const heading = textElement("h3", bucket.label.replace("-", "–"));
    const count = textElement("p", `${affecting.length} for this file · ${bucket.total - affecting.length} elsewhere`);
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

function renderReport(report: ReturnType<typeof createReport>, dataVersion: string): void {
  const { forecast, checked } = report;
  renderBuckets(forecast);
  element("period").textContent = `${forecast.today} to ${forecast.until} · Ebb data ${dataVersion}`;
  const gaps = forecast.noData;
  element("unclassified").hidden = gaps.length === 0;
  element("unclassified-title").textContent = `No data for ${gaps.length} reference${gaps.length === 1 ? "" : "s"}`;
  const rows = document.createDocumentFragment();
  for (const { reference, reason } of gaps) rows.append(textElement("li", `${reference} — ${reason}`));
  element("unclassified-list").replaceChildren(rows);
  status.textContent = checked === 0 ? "No supported declarations found in this file." : "";
  results.hidden = false;
}

async function run(file?: File): Promise<void> {
  const current = ++runId;
  const pasted = contents.value;
  active = undefined;
  results.hidden = true;
  exportStatus.textContent = "";
  try {
    if (!file && !pasted.trim()) throw new Error("Choose a file or paste its contents.");
    const size = file?.size ?? new TextEncoder().encode(pasted).byteLength;
    if (size > maxBytes) throw new Error("Choose a file or paste up to 5 MiB.");
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
  const calendar = renderForecastIcs(active.forecast, active.replacements);
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "offing-forecast.ics";
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
