---
title: Record pinned ownership evidence for fleet forecasts
status: accepted
---

# Record pinned ownership evidence for fleet forecasts

Publish `offing.fleet-forecast.v1` with a reference day and the three disjoint
0–3, 3–6 and 6–12 month buckets. Attribute each dated finding to all owners of
its exact path and once to its repository. Record observed coverage separately
from repositories for which evidence was unavailable.

Ordinary fleet reports and caches carry aggregate data. The distinct
`--forecast-input` mode adds optional evidence to `offing.fleet.v1`: rule ID,
repository-relative location, deadline, matched owner names, and ownership of
unclassified observations. Capture uses the same pinned files as Fleet Scan
with host-specific CODEOWNERS locations added. Keep source contents, dependency
names from unclassified data and credentials outside the recording. Skip the
aggregate cache for detail capture, and strip forecast evidence when rolling up
outputs. A saved recording supplies all the evidence required for offline
rendering.

The forecast uses the same dated lifecycle rules as the repository forecast.
An absence can be reported as fixed only when the current recording contains
evidence for that repository and the previous deadline has yet to pass.
Owner calendars use stable per-owner date identities and group all findings
due on that date. Owner Markdown is exported locally and can be routed by the
caller. Each caller controls access to artifacts containing repository paths
or ownership.
