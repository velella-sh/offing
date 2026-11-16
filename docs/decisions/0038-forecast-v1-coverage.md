# 0038 — Add coverage gaps to forecast v1

Status: proposed

A dated forecast groups events that have evidence. A repository can also contain components
with insufficient lifecycle data. Readers need to see these gaps even when the dated event
count is zero.

Keep `ebb.forecast.v1` and its existing fields, including the month groups, event locations,
and counts. Add a `noData` array to the shared forecast schema. Both `offing forecast --json`
and `forecast_repository` always emit the array, even when empty. The schema accepts earlier
v1 documents that omit it.

Each entry carries a component, reference, reporting detector, reason, and repository-relative
location. The report combines unclassified references from the scan with direct npm
declarations that have no package rule in the active data. Coverage gaps do not contribute
to dated event counts. The terminal report displays them separately and uses `cloudy` for
coverage gaps when the near-term bucket has no high or critical repository event.
