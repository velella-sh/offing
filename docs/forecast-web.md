---
title: Browser lifecycle forecast
description: Check a single dependency file and export lifecycle deadlines from your browser.
---

# Browser lifecycle forecast

[Open the browser forecast](https://velella.sh/offing/forecast-web/app/).

Drop or choose a file, or paste its contents and select **Run forecast**. The forecast
groups dated events into 0–3, 3–6 and 6–12 months from today in UTC. The weather
summarizes the nearest bucket and any coverage gaps. Use **Download .ics** to import
dates that affect your file into a calendar, or **Copy summary** to share the text.

## Supported files

| File | What Offing reads |
| --- | --- |
| `package-lock.json` or `npm-shrinkwrap.json` | Resolved packages in lockfile versions 2 and 3, including transitive dependencies. |
| `package.json` | Direct, development and optional dependencies with exact versions or simple written minimums, plus explicit Node.js versions. |
| `requirements.txt` | Package names with exact pins or written minimum versions. |
| `pyproject.toml` | Project dependencies, optional dependencies, Poetry version strings and the declared Python version or minimum. |
| GitHub Actions workflow | Action refs and declared Node.js, Python and .NET versions. Versioned tags, unambiguous SHA comments and SHAs listed in Ebb's data can be classified. Literal Node.js and Python matrices are supported. |

## Privacy and limits

File names, contents, and results stay in the browser. The page requests its assets and a
fixed, signed Ebb data bundle from the Offing site. It verifies the bundle before using it
and reuses the verified data while the page is open. Downloads and clipboard text are
generated locally. The page needs HTTPS or localhost for signature verification and
clipboard access.

Each forecast reads one file up to 5 MiB. Offing compares listed versions and written
minimums with published dates. It skips dynamic refs and version constraints without a
supported explicit minimum. It does not resolve dependencies, follow requirements includes,
evaluate Python environment markers or execute workflow expressions. Source-level rules,
unlisted packages, and lifecycle events without dates may require further investigation.
Use the [terminal forecast](forecast.md) to scan a full repository.

## Forecast records

[Browser forecast records v1](https://velella.sh/offing/schemas/forecast-records.v1.schema.json)
defines the output of the shared forecast module. The first record gives the UTC
date range, Ebb data version, weather and counts. Each time bucket precedes the
findings it contains. A finding's `bucketUntil` identifies its bucket, and its
`source` links to the lifecycle evidence.

The file record gives the selected filename or identifies pasted input. A
`no-data` notice names an unclassified reference and explains the gap.
`no-supported-declarations` reports an input with no recognized declarations.
The final record contains the locally generated iCalendar text and its media type.
