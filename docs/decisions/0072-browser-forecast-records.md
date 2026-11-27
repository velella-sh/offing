# 0072 Browser forecast records v1

Status: Accepted

## Context

The browser forecast parses one file or pasted manifest and presents the
same time buckets and calendar dates used in the terminal. A renderer needs
a versioned representation of those results.

## Decision

Publish `offing.forecast-records.v1` as an ordered list with a summary,
time buckets, findings, an input record, notices and one calendar download.
Each affected finding carries the HTTPS source from Ebb and its file
locations. Coverage gaps retain the reference, location and reason.
The download contains the calendar text and its media type.

The shared forecast module has no DOM dependency. The current page still
loads its same-origin signed Ebb bundle and verifies the bytes before using
the data. The records describe Offing's output and can be validated
independently of the site's host.
