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

Each file record gives a processed file's name or identifies pasted input. A
`no-data` notice names an unclassified reference and explains the gap.
`no-supported-declarations` reports an input with no recognized declarations.
The final record contains the locally generated iCalendar text and its media type.

## Forecast tool module

Import `run` and `contractVersion` from `@velella/offing/forecast-tool`.
Version 1 of this Offing interface accepts a file's bytes, pasted text or a
repository selector from the host. The module requests just the named Ebb
bundle through `context.data(name)` and verifies its signature and version.
File and paste modes process input locally and make no fetch calls.

Pass an `AbortSignal` in `context.signal` to cancel the run. A forecast
returns a status, a message and typed records including a calendar download.
Validate a populated record list using the schema exported as
`@velella/offing/schemas/forecast-records.v1.schema.json`. Errors and
repository selections with no supported files return an empty list.
A run accepts up to 5 MiB of input, 10,000 declarations and 10,000
matched lifecycle rules. Serialized records are limited to 5 MiB.

The `acc-forecast-island` tests verify file, paste and repository modes with
a signed local fixture. The public page continues to use its existing file and
paste form. Integration and conformance checks with the Mizzen and Lateen
tool host are tracked in [#565](https://github.com/velella-sh/offing/issues/565).

### Refresh the signed Ebb data pin

Download the JSON bundle and its `.sigstore.json` attestation from the same
Ebb data release. Verify them with `verifyDataBundle` from
`@velella/ebb/verify` before using the signing metadata.

Use Node's `X509Certificate` on the attestation's base64 DER
`verificationMaterial.certificate.rawBytes`. Export its P-256 public key
as base64 SPKI DER. Convert the attestation's DER
`messageSignature.signature` to base64 Web Crypto format by left-padding
the two unsigned integers to 32 bytes each and concatenating them.
[DER conversion from the previous build](https://github.com/velella-sh/offing/blob/8fd233c724e165665cd1188e9168671edd2bdf1e/web/forecast/build.ts#L22-L40)

Update the file name, version, public key and signature in
`src/forecast-tool/data.ts`. Run `npm run build:forecast-web` to verify
both the Sigstore attestation and the embedded key and signature against
the downloaded bytes.

## Public repository selectors

The module accepts a `{ kind: "url", value }` input. The value is
`github/<owner>/<repo>` or `github/<owner>/<repo>@<ref>`, with `HEAD` as
the default ref. For a selector taken from a URL fragment, pass the value
without the leading `#`. After the user approves access to GitHub, the host can
provide `context.publicRepositoryFetch`. A selector submitted before that
approval returns an error without requesting data or using the network.

The module makes one unauthenticated Git Trees request to
`https://api.github.com` and reads selected files from
`https://raw.githubusercontent.com` using the fetch supplied by the host.
It omits credentials and refuses redirects. It selects regular files with
the supported names above and YAML files directly under `.github/workflows/`.
The limits are 40 files, 1 MiB per file and 5 MiB across the selected files.
A truncated or invalid tree produces an error before any file downloads.

A branch or tag can move during a forecast. The adapter checks the Git blob
ID of each downloaded file against the tree listing. Use a commit SHA for
a reproducible link. A rate-limit message gives the remaining requests and
the UTC reset time when GitHub sends those values. Each fetched file is
listed in the result and contributes to the same forecast.
