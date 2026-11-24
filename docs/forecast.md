---
title: Forecast end of life
description: See upcoming end-of-life dates, affected files, and gaps in lifecycle data.
---

# Forecast end of life

`offing forecast [path]` scans the repository and shows what reaches a dated end of life
within the selected window. The path defaults to the current directory.
To check a single dependency file, use the [browser forecast](forecast-web.md).
See the [forecast accuracy report](forecast-accuracy.md) for results from public repositories.

The terminal report groups events into 0–3, 3–6, and 6–12 month ranges. Each cutoff day
belongs to the range that ends on it. A shorter window ends at the requested month.
A window longer than 12 months adds a final range. Within each range, repository events
appear by date with their repository-relative paths and available line numbers. The count
labelled `elsewhere` covers dated events with zero findings in this repository.

The first line summarizes the nearest range:

- `storm` means at least one repository event is high or critical.
- `cloudy` means the nearest range has a lower-severity repository event or the report has coverage gaps.
- `clear` means the nearest range has zero repository events and the report found zero coverage gaps. Read the later ranges for upcoming work.

The **No data** section lists declarations the scan could not classify and direct npm dependencies
in the root or its workspaces that have no rule in the active data. Each entry gives its reason and
location, including the declaration line for npm dependencies. The forecast covers dated events and the gaps Offing identified.

| Option | Effect |
| --- | --- |
| `--months <n>` | Set the horizon to a whole number from 1 to 36. Default 12. |
| `--as-of <YYYY-MM-DD>` | Use the specified day at midnight UTC. Default is today's UTC date. `--today` is an alias. |
| `--data-version <version>` | Pin the lifecycle data. Use `bundled` for the data shipped with this build. |
| `--no-cache` | Run a fresh scan. An explicit reference day also uses a fresh scan. |
| `--json` or `--format json` | Print the versioned forecast document. |
| `--format text` | Print the default terminal report. It uses plain labels with or without `NO_COLOR`. |
| `--timeline` | Print a bar chart grouped by calendar month. `NO_COLOR=1` uses ASCII bars. |
| `--svg [--animate]` | Write a self-contained SVG. `--animate` enables CSS animation. |
| `--format mermaid` | Print a Mermaid Gantt chart grouped by ecosystem. |
| `--ics [file]` | Export an [iCalendar file](forecast-calendar.md) to stdout or the named file. Add `--force` to replace an existing file. |

An invalid horizon or date exits with status 2. A replay uses the files present when you
run the command. To repeat a forecast, use the same checkout, date, and data version.

## JSON contract

The [forecast v1 schema](../schemas/forecast.v1.schema.json) describes the document.
`schemaVersion` is `ebb.forecast.v1`. The document includes `root`, `today`, `until`,
`months`, `buckets`, and `groups` of events by calendar month. Each event carries its
date, rule, severity, source, and finding locations. `affecting` counts events with
findings and `total` counts all dated events in the window. `noData` contains the
coverage gaps and is an empty array when the report finds zero gaps.

`buckets` is the grouping the terminal report prints: events by how many months away
they are, `0-3 months`, `3-6 months`, and `6-12 months`, then on to the horizon when it
is longer, such as `12-36 months` for a three-year window. Every event is in exactly one
bucket, by its date. A bucket's `total` counts every event in it and `affecting` counts
the ones with findings here; `events` lists only those, so it has `affecting` elements.
The bucket totals add up to `total`.

## Examples

Run these from an Offing checkout after `npm ci`. The example runner builds the CLI and
restores the fixtures' original filenames in a temporary directory.

### Replay a near-term deadline

```bash
npm run example --silent -- demo forecast --as-of 2025-03-01 --months 3 --data-version bundled
```

```text
Weather: storm
Forecast from 2025-03-01 to 2025-06-01 (3 months)

0-3 months
  1 affecting this repository, 2 elsewhere
  2025-04-30  Node.js 18 is end-of-life [high] (nodejs.runtime.eol-18)
    package.json:5
```

### Read affected locations in plain text

```bash
NO_COLOR=1 npm run example --silent -- drift/nodejs forecast --as-of 2027-02-01 --months 3 --data-version bundled
```

```text
Weather: cloudy
Forecast from 2027-02-01 to 2027-05-01 (3 months)

0-3 months
  2 affecting this repository, 0 elsewhere
  2027-04-30  Node.js image release line 22 reaches end-of-life on 2027-04-30 [low] (container.node.eol-22-and-older)
    Dockerfile:1
  2027-04-30  Node.js 22 reaches end-of-life on 2027-04-30 [low] (nodejs.runtime.eol-22)
    .github/workflows/ci.yml:10
    .nvmrc:1
    package.json:8
```

### Read the version and counts from JSON

```bash
npm run example --silent -- drift/nodejs forecast --as-of 2027-02-01 --months 3 --data-version bundled --json |
  node -e 'const { schemaVersion, months, affecting, total, noData } = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
  console.log(JSON.stringify({ schemaVersion, months, affecting, total, noData }, null, 2))'
```

```json
{
  "schemaVersion": "ebb.forecast.v1",
  "months": 3,
  "affecting": 2,
  "total": 2,
  "noData": []
}
```
