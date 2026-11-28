import type { ForecastEvent } from "@velella/ebb/forecast";
import type { UnclassifiedReference } from "./domain.js";
import type { ForecastBucket } from "./forecast-timeline.js";

/** Supply local file bytes, pasted text or a public GitHub repository selector. */
export type ForecastToolInput =
  | { kind: "file"; name: string; type: string; bytes: Uint8Array }
  | { kind: "paste"; text: string }
  | { kind: "url"; value: string };

/** Provide cancellation, signed data bytes and optional approved public repository access. */
export interface ForecastToolContext {
  signal: AbortSignal;
  data(name: string): Promise<Uint8Array>;
  /** Present only after the user approves fetching a public GitHub repository. */
  publicRepositoryFetch?: typeof fetch;
}

interface SummaryRecord {
  kind: "summary";
  today: string;
  until: string;
  dataVersion: string;
  weather: "clear" | "cloudy" | "storm";
  checked: number;
  affecting: number;
  total: number;
}

/** Explain why a supported repository path could not contribute to the forecast. */
export interface ForecastSkippedFile {
  path: string;
  reason: string;
}

type DetailRecord =
  | (Omit<ForecastBucket, "events"> & { kind: "time-bucket" })
  | (ForecastEvent & { kind: "finding"; bucketUntil: string })
  | { kind: "file-read"; input: "file"; path: string }
  | { kind: "file-read"; input: "paste" }
  | ({ kind: "file-skipped" } & ForecastSkippedFile)
  | { kind: "notice"; code: "repository-network"; message: string }
  | { kind: "notice"; code: "repository-skipped-overflow"; count: number }
  | (Omit<UnclassifiedReference, "detector"> & { kind: "notice"; code: "no-data" })
  | { kind: "notice"; code: "no-supported-declarations" }
  | {
      kind: "downloadable-file";
      name: "offing-forecast.ics";
      mediaType: "text/calendar;charset=utf-8";
      content: string;
    };

/** Represent a schema-versioned forecast with its summary first. */
export interface ForecastRecords {
  schemaVersion: "offing.forecast-records.v1";
  records: [SummaryRecord, ...DetailRecord[]];
}

/** Report the run status and any forecast records the host can display. */
export interface ForecastToolResult {
  status: "ok" | "no-data" | "error";
  message: string;
  records: ForecastRecords["records"] | [];
}
