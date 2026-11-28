import type {
  ForecastRecords,
  ForecastSkippedFile,
  ForecastToolContext,
  ForecastToolInput,
  ForecastToolResult,
} from "../forecast-tool-types.js";
import { forecastWeather } from "../forecast-core.js";
import { renderForecastIcs } from "../forecast-ics.js";
import { loadForecastData, type ForecastData, type ForecastDataRelease } from "./data.js";
import { readGitHubForecastFiles, repositoryNetworkNotice } from "./remote/github.js";
import { type createReport, createRepositoryReport, createToolReport } from "./report.js";

type ForecastReport = ReturnType<typeof createReport>;
type DetailRecord = Exclude<ForecastRecords["records"][number], { kind: "summary" }>;

interface RepositorySources {
  read: string[];
  skipped: ForecastSkippedFile[];
  omitted: number;
}

function sourceRecords(root: string, repository?: RepositorySources): DetailRecord[] {
  const file = (path: string): DetailRecord => ({ kind: "file-read", input: "file", path });
  if (!repository) return root ? [file(root)] : [{ kind: "file-read", input: "paste" }];
  const records: DetailRecord[] = [
    ...repository.read.map(file),
    ...repository.skipped.map((skip): DetailRecord => ({ kind: "file-skipped", ...skip })),
    { kind: "notice", code: "repository-network", message: repositoryNetworkNotice },
  ];
  if (repository.omitted)
    records.push({ kind: "notice", code: "repository-skipped-overflow", count: repository.omitted });
  return records;
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
export function toForecastRecords(
  report: ForecastReport,
  dataVersion: string,
  repository?: RepositorySources,
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
    records: [summary, ...details, ...sourceRecords(forecast.root, repository), ...notices, calendarRecord(report)],
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

/** Discover and parse public sources using the same parsers as local inputs. */
export async function prepareGitHubForecast(
  value: string,
  fetchPublic: typeof fetch,
  loadData: () => Promise<ForecastData>,
  today: string,
  signal: AbortSignal,
) {
  const { files, skipped, omitted } = await readGitHubForecastFiles({ kind: "url", value }, fetchPublic, signal);
  signal.throwIfAborted();
  if (!files.length && !skipped.length) return undefined;
  const data = await loadData();
  signal.throwIfAborted();
  const result = createRepositoryReport(files, data, today, value);
  return {
    report: result.report,
    repository: { read: result.read, skipped: [...skipped, ...result.skipped], omitted },
    dataVersion: data.version,
  };
}

function boundedResult(report: ForecastReport, version: string, repository?: RepositorySources): ForecastToolResult {
  const { records } = toForecastRecords(report, version, repository);
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
    const loadData = () => loadForecastData((file) => context.data(file), release, context.signal);
    if (input.kind === "url") {
      const fetchPublic = context.publicRepositoryFetch;
      if (!fetchPublic) throw new Error("Approve access to GitHub before running a repository forecast.");
      const result = await prepareGitHubForecast(input.value, fetchPublic, loadData, today, context.signal);
      return result
        ? boundedResult(result.report, result.dataVersion, result.repository)
        : { status: "no-data", message: "No supported repository files found.", records: [] };
    }
    const contents = readInput(input);
    if (!contents.trim()) throw new Error("Choose a file or paste its contents.");
    const data = await loadData();
    const report = createToolReport(contents, data, today, input.kind === "file" ? input.name : undefined);
    return boundedResult(report, data.version);
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not prepare the forecast.",
      records: [],
    };
  }
}
