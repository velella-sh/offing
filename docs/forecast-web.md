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

## Repository link adapter in development

The adapter accepts the tool host's URL value `github/<owner>/<repo>` or
`github/<owner>/<repo>@<ref>`, with `HEAD` as the default ref. Its focused
acceptance check, `acc-forecast-link`, runs the adapter against a GitHub-shaped
fixture. The public page uses the file and paste inputs described above.

The adapter makes one unauthenticated Git Trees request to
`https://api.github.com` and reads selected files from
`https://raw.githubusercontent.com` using the fetch supplied by the host.
It omits credentials and refuses redirects. It selects regular files with
the supported names above and YAML files directly under `.github/workflows/`.
The limits are 40 files, 1 MiB per file and 5 MiB across the selected files.
A truncated or invalid tree produces an error before any file downloads.

A branch or tag can move during a forecast. The adapter checks the Git blob
ID of each downloaded file against the tree listing. Use a commit SHA for
a reproducible link. A rate-limit message gives the remaining requests and
the UTC reset time when GitHub sends those values.
