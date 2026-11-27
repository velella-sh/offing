import type { ForecastEvent } from "@velella/ebb/forecast";

import type { UnclassifiedReference } from "../domain.js";
import { forecastWeather } from "../forecast-core.js";
import { renderForecastIcs } from "../forecast-ics.js";
import type { ForecastBucket } from "../forecast-timeline.js";
import type { createReport } from "./report.js";

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
