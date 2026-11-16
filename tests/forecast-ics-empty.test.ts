import assert from "node:assert/strict";
import { test } from "node:test";

import ICAL from "ical.js";

import { renderForecastIcs } from "../src/forecast-ics.js";
import { forecastOn } from "./forecast-ics-fixture.js";

test("an empty forecast is a calendar with zero events", () => {
  const ics = renderForecastIcs(forecastOn("2026-10-25"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  const calendar = new ICAL.Component(ICAL.parse(ics));
  assert.equal(calendar.name, "vcalendar");
  assert.equal(calendar.getFirstPropertyValue("version"), "2.0");
  assert.equal(calendar.getFirstPropertyValue("prodid"), "-//Velella//Offing Forecast//EN");
  assert.deepEqual(calendar.getAllSubcomponents("vevent"), []);
});
