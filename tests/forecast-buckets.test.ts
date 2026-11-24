import assert from "node:assert/strict";
import { test } from "node:test";

import type { Forecast, ForecastEvent } from "@velella/ebb/forecast";
import { forecastBuckets } from "../src/forecast-timeline.js";

/** One dated event on `date`; it affects the repository unless `elsewhere` is set. */
function event(date: string, elsewhere = false, ruleId = date): ForecastEvent {
  return {
    date,
    ruleId,
    title: date,
    ecosystem: "test",
    severity: "low",
    source: "",
    findings: elsewhere ? [] : [{ id: `${ruleId}:manifest`, path: "manifest" }],
  };
}

function forecastOf(dates: ForecastEvent[], months: number, until: string): Forecast {
  return {
    schemaVersion: "ebb.forecast.v1",
    root: "/repo",
    today: "2026-10-25",
    until,
    months,
    groups: [{ month: "2026-10", events: dates }],
    affecting: dates.filter((item) => item.findings.length > 0).length,
    total: dates.length,
  };
}

const dates = ["2026-10-25", "2027-01-25", "2027-01-26", "2027-04-25", "2027-04-26", "2027-10-25", "2027-10-26"];
const byDate = dates.map((date) => event(date));

test("every boundary day belongs to exactly one bucket and events are sorted", () => {
  const buckets = forecastBuckets(forecastOf([...byDate].reverse(), 18, "2028-04-25"));

  assert.deepEqual(
    buckets.map(({ from, to, until, label, events }) => [from, to, until, label, events.map(({ date }) => date)]),
    [
      [0, 3, "2027-01-25", "0-3 months", dates.slice(0, 2)],
      [3, 6, "2027-04-25", "3-6 months", dates.slice(2, 4)],
      [6, 12, "2027-10-25", "6-12 months", dates.slice(4, 6)],
      [12, 18, "2028-04-25", "12-18 months", dates.slice(6)],
    ],
  );
  assert.equal(buckets.flatMap((bucket) => bucket.events).length, dates.length);
});

test("a bucket counts every event and lists the ones that affect the repository", () => {
  const events = [
    event("2026-11-01", true, "elsewhere.nov"),
    event("2026-12-01", false, "here.dec"),
    event("2027-02-01", true, "elsewhere.feb"),
    event("2027-03-01", false, "here.mar"),
  ];
  const buckets = forecastBuckets(forecastOf(events, 12, "2027-10-25"));

  assert.deepEqual(
    buckets.map(({ total, affecting, events }) => [total, affecting, events.map(({ ruleId }) => ruleId)]),
    [
      [2, 1, ["here.dec"]],
      [2, 1, ["here.mar"]],
      [0, 0, []],
    ],
    "the last bucket of a twelve-month window is empty here and is still reported",
  );
  assert.ok(buckets.every((bucket) => bucket.events.length === bucket.affecting));
});

test("the forecast ends at the requested horizon", () => {
  const four = forecastBuckets(forecastOf([], 4, "2027-02-25"));
  assert.deepEqual(
    four.map(({ from, to, until, label }) => [from, to, until, label]),
    [
      [0, 3, "2027-01-25", "0-3 months"],
      [3, 4, "2027-02-25", "3-4 months"],
    ],
  );
  assert.deepEqual(
    forecastBuckets(forecastOf([], 3, "2027-01-25")).map(({ from, to, label }) => [from, to, label]),
    [[0, 3, "0-3 months"]],
  );
});

test("grouping changes neither the events nor the month groups it reads", () => {
  const forecast = forecastOf([...byDate].reverse(), 12, "2027-10-25");
  const before = JSON.stringify(forecast);

  forecastBuckets(forecast);

  assert.equal(JSON.stringify(forecast), before);
  assert.deepEqual(
    forecast.groups[0]?.events.map(({ date }) => date),
    [...dates].reverse(),
    "the caller's order is left alone",
  );
});
