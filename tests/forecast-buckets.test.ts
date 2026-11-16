import assert from "node:assert/strict";
import { test } from "node:test";

import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";
import { forecastBuckets } from "../src/forecast-timeline.js";

function event(date: string): ForecastEvent {
  return { date, ruleId: date, title: date, ecosystem: "test", severity: "low", source: "", findings: [] };
}

const dates = ["2026-10-25", "2027-01-25", "2027-01-26", "2027-04-25", "2027-04-26", "2027-10-25", "2027-10-26"];
const forecast: Forecast = {
  schemaVersion: "ebb.forecast.v1",
  root: "/repo",
  today: "2026-10-25",
  until: "2028-04-25",
  months: 18,
  groups: [{ month: "2026-10", events: [...dates].reverse().map(event) }],
  affecting: 0,
  total: dates.length,
};

test("every boundary day belongs to exactly one bucket and events are sorted", () => {
  const buckets = forecastBuckets(forecast);
  assert.deepEqual(
    buckets.map(({ label, events }) => [label, events.map(({ date }) => date)]),
    [
      ["0-3 months", dates.slice(0, 2)],
      ["3-6 months", dates.slice(2, 4)],
      ["6-12 months", dates.slice(4, 6)],
      ["12-18 months", dates.slice(6)],
    ],
  );
  assert.deepEqual(
    forecast.groups[0]?.events.map(({ date }) => date),
    [...dates].reverse(),
  );
});

test("the forecast ends at the requested horizon", () => {
  assert.deepEqual(
    forecastBuckets({ ...forecast, months: 4, until: "2027-02-25", groups: [] }).map(({ label }) => label),
    ["0-3 months", "3-4 months"],
  );
});
