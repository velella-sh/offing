import type {
  ForecastRecords,
  ForecastToolContext,
  ForecastToolInput,
  ForecastToolResult,
} from "../forecast-tool-types.js";
import { forecastWeather } from "../forecast-core.js";
import { renderForecastIcs } from "../forecast-ics.js";
import { loadForecastData, type ForecastDataRelease } from "./data.js";
import { readGitHubForecastFiles } from "./remote/github.js";
import { type createReport, createToolReport, type ForecastInputFile } from "./report.js";

type ForecastReport = ReturnType<typeof createReport>;
type DetailRecord = Exclude<ForecastRecords["records"][number], { kind: "summary" }>;

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
export function toForecastRecords(
  report: ForecastReport,
  dataVersion: string,
  paths: readonly string[] = report.forecast.root ? [report.forecast.root] : [],
): ForecastRecords {
  const { forecast, checked } = report;
  const { today, until, buckets, noData, affecting, total } = forecast;
  const summary: ForecastRecords["records"][0] = {
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
  const sourceRecords: DetailRecord[] = paths.length
    ? paths.map((path) => ({ kind: "file-read", input: "file", path }))
    : [{ kind: "file-read", input: "paste" }];
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
    records: [summary, ...details, ...sourceRecords, ...notices, calendarRecord(report)],
  };
}

export const maxInputBytes = 5 * 1024 * 1024;
const maxRecordsBytes = 5 * 1024 * 1024;

function readInput(input: Exclude<ForecastToolInput, { kind: "url" }>): string {
  if (input.kind === "file") {
    if (!input.name.trim() || input.name.length > 4096 || /[\p{Cc}\p{Surrogate}]/u.test(input.name)) {
      throw new Error("Choose a file with a valid name.");
    }
    if (input.bytes.byteLength > maxInputBytes) throw new Error("Choose a file or paste up to 5 MiB.");
    return new TextDecoder().decode(input.bytes);
  }
  if (input.text.length > maxInputBytes || new TextEncoder().encode(input.text).byteLength > maxInputBytes) {
    throw new Error("Choose a file or paste up to 5 MiB.");
  }
  return input.text;
}

async function selectedFiles(input: ForecastToolInput, context: ForecastToolContext): Promise<ForecastInputFile[]> {
  if (input.kind === "url") {
    if (!context.publicRepositoryFetch)
      throw new Error("Approve access to GitHub before running a repository forecast.");
    if (input.value.length > 8192) throw new Error("The repository selector is too long.");
    return readGitHubForecastFiles(input, context.publicRepositoryFetch, context.signal);
  }
  const contents = readInput(input);
  if (!contents.trim()) throw new Error("Choose a file or paste its contents.");
  return [{ contents, ...(input.kind === "file" ? { path: input.name } : {}) }];
}

function boundedResult(
  report: ForecastReport,
  version: string,
  files: readonly ForecastInputFile[],
): ForecastToolResult {
  const paths = files.flatMap(({ path }) => (path === undefined ? [] : [path]));
  const { records } = toForecastRecords(report, version, paths);
  const serialized = JSON.stringify(records);
  if (serialized.length > maxRecordsBytes || new TextEncoder().encode(serialized).byteLength > maxRecordsBytes) {
    throw new Error("The forecast records exceed the 5 MiB result limit.");
  }
  return report.checked === 0
    ? { status: "no-data", message: "No supported declarations found.", records }
    : { status: "ok", message: "Forecast ready.", records };
}

/** Run against a selected signed release and UTC day. */
export async function runForecastTool(
  input: ForecastToolInput,
  context: ForecastToolContext,
  release: ForecastDataRelease,
  today: string,
): Promise<ForecastToolResult> {
  context.signal.throwIfAborted();
  try {
    const files = await selectedFiles(input, context);
    context.signal.throwIfAborted();
    if (!files.length) return { status: "no-data", message: "No supported repository files found.", records: [] };
    const data = await loadForecastData((file) => context.data(file), release, context.signal);
    const root = input.kind === "file" ? input.name : input.kind === "url" ? input.value : "";
    const report = createToolReport(files, data, today, root);
    return boundedResult(report, data.version, files);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not prepare the forecast.",
      records: [],
    };
  }
}
