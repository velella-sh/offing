import assert from "node:assert/strict";
import { test } from "node:test";

import ICAL from "ical.js";

import { renderForecastIcs } from "../src/forecast-ics.js";
import { forecastOn, lifecycleEvent } from "./forecast-ics-fixture.js";

test("identical forecasts produce identical bytes and added events preserve existing UIDs", () => {
  const event = lifecycleEvent();
  const calendar = renderForecastIcs(forecastOn("2026-10-25", event));
  assert.equal(calendar, renderForecastIcs(forecastOn("2026-10-25", lifecycleEvent())));
  assert.match(calendar, /^DTSTAMP:20261025T000000Z\r$/m);

  const newer = renderForecastIcs(forecastOn("2026-10-26", lifecycleEvent({ date: "2027-03-01" }), event));
  const ids = (ics: string) =>
    new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents("vevent").map((item) => new ICAL.Event(item).uid);
  assert.deepEqual(ids(calendar), ["demo.eol-2027-04-30@offing"]);
  assert.deepEqual(ids(newer), ["demo.eol-2027-03-01@offing", ...ids(calendar)]);
});
