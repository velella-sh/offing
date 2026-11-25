# 0041 — Add the report's buckets to forecast v1

Status: proposed; accepted when the maintainer merges the pull request for #115.

The terminal report groups a forecast by how many months away each event is: `0-3 months`, `3-6 months`, and
`6-12 months`, then on to the horizon. The `--json` document and the `forecast_repository` MCP tool grouped the same
events by calendar month only. An agent that asked what ends soon had to rebuild the horizon grouping from
`groups`, and it did so three different ways across the terminal report, the first-run summary, and the browser page.

Keep `ebb.forecast.v1` and its existing fields. Add an optional `buckets` array ahead of `groups`. Both
`offing forecast --json` and `forecast_repository` always emit it. The schema accepts earlier v1 documents that omit
it, as it does for `noData`.

Each bucket carries the months it spans (`from`, `to`), its last day (`until`), the label the terminal report
prints, `total` for every event in the bucket, `affecting` for the ones with findings here, and `events`, which
lists only those, so it has `affecting` elements. Every event is in exactly one bucket, by its date, and the bucket
totals add up to `total`. An event in a bucket is the schema's own `$defs/event`: there is no second shape.

One `ForecastBucket` is the shape for every reader. The document builder computes the buckets once; the terminal
report, the first-run summary, and the browser page read them from the document instead of grouping the events
again.

A bucket lists only the events that affect the repository because that is what the terminal report prints under
each heading, and because an MCP answer is held under 2,000 tokens (decision 0040): the events that affect nothing
here would spend that budget before the ones that do.

The 100 committed forecast snapshots under `validation/snapshots/` were recorded again with the tool. Each gained
`buckets` and changed in nothing else; `validation/timings.json` keeps the timings it already published.
