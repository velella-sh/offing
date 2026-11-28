---
title: Browser lifecycle forecast
description: Check a local dependency file or a public GitHub repository for lifecycle deadlines in your browser.
---

# Browser lifecycle forecast

[Open the browser forecast](https://velella.sh/offing/forecast-web/app/).

For a private or local file, drop or choose it, or paste its contents and select **Run forecast**.
For a public GitHub repository, see [Public repository links](#public-repository-links).
The forecast groups dated events into 0–3, 3–6 and 6–12 months from today in UTC. The weather
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

Names and contents from the local file and paste forms stay in the browser, along with
forecast results. The page requests its assets and a fixed, signed Ebb data bundle from
the Offing site. It verifies the bundle before using it
and reuses the verified data while the page is open. Downloads and clipboard text are
generated locally. The page needs HTTPS or localhost for signature verification and
clipboard access.

A local forecast accepts one file or paste up to 5 MiB. Offing compares listed versions and written
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

A `file-read` record gives a processed file's name or identifies pasted input.
A repository forecast adds `file-skipped` records with the path and reason
and a `repository-network` notice naming the two GitHub hosts and what they
receive. A `repository-skipped-overflow` notice gives the count of budget
skips beyond the listed paths. A `no-data` notice names an unclassified reference and explains the gap.
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
Wrap a populated record list with `{ schemaVersion: "offing.forecast-records.v1", records }`
to validate it against `@velella/offing/schemas/forecast-records.v1.schema.json`.
Errors and repositories with no supported paths to report return an empty list.
A run accepts up to 5 MiB of input, 10,000 declarations and 10,000
matched lifecycle rules. Serialized records are limited to 5 MiB.

The `acc-forecast-island` tests verify file, paste and repository modes with
a signed local fixture. The `acc-forecast-link` checks exercise consent,
cancellation, file reporting and recorded GitHub error responses.
Mizzen and Lateen host conformance is tracked in
[#565](https://github.com/velella-sh/offing/issues/565).

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

## Public repository links

Enter `github/<owner>/<repo>` in the browser's **Public GitHub repository**
field, or [open a public repository link](https://velella.sh/offing/forecast-web/app/#github/expressjs/express).
A URL fragment fills the field without making requests. Review the notice
and select **Fetch public files and run forecast** to approve the lookup.
After submission you can copy the address to share the selected repository.
For repeatable results, [link to a commit](https://velella.sh/offing/forecast-web/app/#github/expressjs/express@a419aa7350389a275ab45fde2e849ed1f02449ef)
with `github/<owner>/<repo>@<commit-sha>`. Tags and branch names also work,
with `HEAD` as the default ref. To stop a fetch, select **Cancel fetch**,
change the repository or start a local forecast.

The browser makes one anonymous Git Trees request to `api.github.com` and
downloads selected files from `raw.githubusercontent.com`. Offing omits
credentials and refuses redirects. No repository contents or forecast results
are sent to Velella. For private, missing or empty repositories, use the
file or paste form. A private repository and a missing repository can return
the same GitHub response.

Offing reads the supported manifest and lockfile names above at any depth and
YAML files directly in `.github/workflows/`. It selects regular files by
path, with a limit of 40 files, 1 MiB per file, 5 MiB across downloads and
8 MiB of decoded bytes for the tree response. An invalid or truncated tree stops the run.
Offing verifies the Git blob ID of each download and stops if the contents
changed during the fetch. It lists each parsed file, each empty or invalid
download and up to 40 supported paths skipped before downloading. The
remaining count is shown if the skip list hits its limit.

A rate-limit message includes the remaining request count and UTC reset time
when GitHub supplies them. Wait for the reset or choose a local file. Offing
does not retry automatically.

For a module host, pass `{ kind: "url", value }` with the selector and no
leading `#`. Supply `context.publicRepositoryFetch` only after the user's
approval. Without the capability, `run` returns a consent error before making
a network request or reading data.
