import type { ForecastEvent } from "@velella/ebb/forecast";

import type { UnclassifiedReference } from "../domain.js";
import { forecastWeather } from "../forecast-core.js";
import { renderForecastIcs } from "../forecast-ics.js";
import type { ForecastBucket } from "../forecast-timeline.js";
import { forecastDataRelease, loadForecastData, type ForecastDataRelease } from "./data.js";
import { createReport } from "./report.js";

type ForecastReport = ReturnType<typeof createReport>;

interface SummaryRecord {
  kind: "summary";
  today: string;
  until: string;
  dataVersion: string;
  weather: ReturnType<typeof forecastWeather>;
  checked: number;
  affecting: number;
  total: number;
}

type DetailRecord =
  | (Omit<ForecastBucket, "events"> & { kind: "time-bucket" })
  | (ForecastEvent & { kind: "finding"; bucketUntil: string })
  | { kind: "file-read"; input: "file"; path: string }
  | { kind: "file-read"; input: "paste" }
  | (Omit<UnclassifiedReference, "detector"> & { kind: "notice"; code: "no-data" })
  | { kind: "notice"; code: "no-supported-declarations" }
  | ReturnType<typeof calendarRecord>;

interface ForecastRecords {
  schemaVersion: "offing.forecast-records.v1";
  records: [SummaryRecord, ...DetailRecord[]];
}

/** Prepare a calendar download without requiring any particular renderer. */
export function calendarRecord({ forecast, replacements }: ForecastReport) {
  return {
    kind: "downloadable-file",
    name: "offing-forecast.ics",
    mediaType: "text/calendar;charset=utf-8",
    content: renderForecastIcs(forecast, replacements),
  } as const;
}

/** Project a browser forecast into the versioned Offing records, independent of the page or tool host. */
export function toForecastRecords(report: ForecastReport, dataVersion: string): ForecastRecords {
  const { forecast, checked } = report;
  const { root, today, until, buckets, noData, affecting, total } = forecast;
  const summary: SummaryRecord = {
    kind: "summary",
    today,
    until,
    dataVersion,
    weather: forecastWeather(buckets[0]?.events ?? [], noData.length > 0),
    checked,
    affecting,
    total,
  };
  const details = buckets.flatMap(({ events, ...bucket }): DetailRecord[] => [
    { kind: "time-bucket", ...bucket },
    ...events.map((event): DetailRecord => ({ kind: "finding", bucketUntil: bucket.until, ...event })),
  ]);
  const file: DetailRecord = root
    ? { kind: "file-read", input: "file", path: root }
    : { kind: "file-read", input: "paste" };
  const notices = noData.map(
    ({ component, reference, reason, location }): DetailRecord => ({
      kind: "notice",
      code: "no-data",
      component,
      reference,
      reason,
      location,
    }),
  );
  if (checked === 0) notices.push({ kind: "notice", code: "no-supported-declarations" });
  return {
    schemaVersion: "offing.forecast-records.v1",
    records: [summary, ...details, file, ...notices, calendarRecord(report)],
  };
}

/** Version of the tool host contract described by the Mizzen roadmap. */
export const contractVersion = 1;
export const name = "offing-forecast";
export const inputs = ["file", "paste", "url"] as const;
export const maxInputBytes = 5 * 1024 * 1024;
export const recordsSchema = "https://velella.sh/offing/schemas/forecast-records.v1.schema.json";

type ForecastToolInput =
  | { kind: "file"; name: string; type: string; bytes: Uint8Array }
  | { kind: "paste"; text: string }
  | { kind: "url"; value: string };

interface ForecastToolContext {
  signal: AbortSignal;
  data(name: string): Promise<Uint8Array>;
}

interface ForecastToolResult {
  status: "ok" | "no-data" | "error";
  message: string;
  records: ForecastRecords["records"] | [];
}

function readInput(input: Exclude<ForecastToolInput, { kind: "url" }>): string {
  if (input.kind === "file") {
    if (!input.name.trim()) throw new Error("Choose a named file.");
    if (input.bytes.byteLength > maxInputBytes) throw new Error("Choose a file or paste up to 5 MiB.");
    return new TextDecoder().decode(input.bytes);
  }
  if (input.text.length > maxInputBytes || new TextEncoder().encode(input.text).byteLength > maxInputBytes) {
    throw new Error("Choose a file or paste up to 5 MiB.");
  }
  return input.text;
}

/** Run the local-input frontend against a selected signed release and UTC day. */
export async function runForecastTool(
  input: ForecastToolInput,
  context: ForecastToolContext,
  release: ForecastDataRelease,
  today: string,
): Promise<ForecastToolResult> {
  context.signal.throwIfAborted();
  if (input.kind === "url") {
    return { status: "error", message: "Repository links require the tool-island integration.", records: [] };
  }
  try {
    const contents = readInput(input);
    if (!contents.trim()) throw new Error("Choose a file or paste its contents.");
    const data = await loadForecastData((file) => context.data(file), release, context.signal);
    const report = createReport(contents, data, today, input.kind === "file" ? input.name : undefined);
    const { records } = toForecastRecords(report, data.version);
    return report.checked === 0
      ? { status: "no-data", message: "No supported declarations found.", records }
      : { status: "ok", message: "Forecast ready.", records };
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not prepare the forecast.",
      records: [],
    };
  }
}

/** Run the forecast tool using its embedded release trust and the current UTC day. */
export function run(input: ForecastToolInput, context: ForecastToolContext): Promise<ForecastToolResult> {
  return runForecastTool(input, context, forecastDataRelease, new Date().toISOString().slice(0, 10));
}
