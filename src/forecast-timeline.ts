import { addMonths } from "@velella/ebb/forecast";
import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";

import { required } from "./required.js";

/**
 * The events of one horizon of a forecast: 0-3, 3-6, and 6-12 months, then on to the horizon when it is longer.
 * Every event is in exactly one bucket, by its date.
 */
export interface ForecastBucket {
  /** Months after the window starts where the bucket begins. */
  from: number;
  /** Months after the window starts where the bucket ends, which is the horizon for the last bucket. */
  to: number;
  /** The last day in the bucket. */
  until: string;
  /** The horizon as the terminal report prints it, such as `0-3 months`. */
  label: string;
  /** Every event in the bucket. */
  total: number;
  /** How many of them affect at least one finding in the repository. */
  affecting: number;
  /** The events that affect at least one finding in the repository, earliest first. */
  events: ForecastEvent[];
}

/**
 * Groups the existing events at inclusive calendar-month cutoffs, retaining any longer horizon. It changes how
 * no event is computed. The terminal report, the JSON document, and the browser page all read these buckets.
 */
export function forecastBuckets(forecast: Forecast): ForecastBucket[] {
  const cutoffs = [3, 6, 12].filter((months) => months < forecast.months);
  const horizons = [...cutoffs, forecast.months];
  const ends = [...cutoffs.map((months) => addMonths(forecast.today, months)), forecast.until];
  const grouped: ForecastEvent[][] = horizons.map(() => []);

  const events = forecast.groups.flatMap((group) => group.events);
  events.sort((left, right) => left.date.localeCompare(right.date) || left.ruleId.localeCompare(right.ruleId));
  for (const event of events) {
    grouped[ends.findIndex((until) => event.date <= until)]?.push(event);
  }

  return horizons.map((to, index) => {
    const all = grouped[index] ?? [];
    const affecting = all.filter((event) => event.findings.length > 0);
    const from = cutoffs[index - 1] ?? 0;
    return {
      from,
      to,
      until: required(ends[index], "the last day of a forecast bucket"),
      label: `${from}-${to} months`,
      total: all.length,
      affecting: affecting.length,
      events: affecting,
    };
  });
}

export interface ForecastTimelineOptions {
  /** Total width in columns. Defaults to 80. */
  width?: number;
  /** When false, the output is plain ASCII. Defaults to false. */
  color?: boolean;
}

const DEFAULT_WIDTH = 80;
/** The `YYYY-MM` label column. */
const LABEL = 7;
/** Two spaces between the label, the axis, and the counts. */
const GAP = "  ";
const ANSI = {
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  reset: "\u001b[0m",
} as const;

interface TimelineRow {
  month: string;
  events: number;
  findings: number;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `2026-10-16` to `2027-04-16` is seven months, not six: both edge months are touched. */
function windowMonths(from: string, to: string): string[] {
  const index = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const last = index(to);
  const months: string[] = [];
  // String arithmetic only: a Date would bring the local calendar and the locale into the output.
  for (let month = index(from); month <= last; month += 1) {
    months.push(`${String(Math.floor(month / 12)).padStart(4, "0")}-${String((month % 12) + 1).padStart(2, "0")}`);
  }
  return months;
}

function timelineRows(forecast: Forecast, months: readonly string[]): TimelineRow[] {
  const groups = new Map(forecast.groups.map((group) => [group.month, group.events]));
  return months.map((month) => {
    const events = groups.get(month) ?? [];
    return {
      month,
      events: events.length,
      findings: events.reduce((count, event) => count + event.findings.length, 0),
    };
  });
}

/** The counts printed after the bar, or an empty string for a month with no dated event. */
function detailOf(row: TimelineRow): string {
  if (row.events === 0) return "";
  const findings = row.findings === 0 ? "" : `${GAP}! ${plural(row.findings, "finding")}`;
  return `${plural(row.events, "event")}${findings}`;
}

/**
 * Draws the forecast as a bar per calendar month the window touches, scaled to the busiest month.
 * A month whose events hit findings in the scanned repository carries a `!` marker and the number
 * of findings. Reads nothing but its arguments — no clock, locale, or terminal — so the same
 * forecast always renders the same string.
 *
 * The bar gives up width first; labels and counts are never truncated, so a width too small for
 * them produces lines wider than requested.
 */
export function renderForecastTimeline(forecast: Forecast, options: ForecastTimelineOptions = {}): string {
  const rows = timelineRows(forecast, windowMonths(forecast.today, forecast.until));
  const emptyMessage = `Nothing reaches a dated end of life between ${forecast.today} and ${forecast.until}.`;
  if (forecast.total === 0 || rows.length === 0) return emptyMessage;

  const detailWidth = Math.max(...rows.map((row) => detailOf(row).length));
  const requested = options.width ?? DEFAULT_WIDTH;
  const width = Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_WIDTH;
  const barWidth = Math.max(1, width - (LABEL + GAP.length * 2 + 1 + detailWidth));
  const busiest = Math.max(...rows.map((row) => row.events));
  const color = options.color ?? false;
  const paint = (text: string, sgr: string): string => (color ? `${sgr}${text}${ANSI.reset}` : text);
  const axis = paint(color ? "│" : "|", ANSI.dim);

  const lines = [
    `Forecast from ${forecast.today} to ${forecast.until} (${forecast.months} month${forecast.months === 1 ? "" : "s"})`,
    "",
  ];
  for (const row of rows) {
    if (row.events === 0) {
      lines.push(`${row.month}${GAP}${axis}`);
      continue;
    }
    const cells = Math.max(1, Math.round((row.events / busiest) * barWidth));
    const bar = `${paint((color ? "█" : "#").repeat(cells), ANSI.green)}${" ".repeat(barWidth - cells)}`;
    const marker = row.findings === 0 ? "" : `${GAP}${paint(`! ${plural(row.findings, "finding")}`, ANSI.yellow)}`;
    lines.push(`${row.month}${GAP}${axis}${bar}${GAP}${plural(row.events, "event")}${marker}`);
  }
  return lines.join("\n");
}
