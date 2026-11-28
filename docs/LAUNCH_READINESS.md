---
title: Launch readiness
description: Read evidence about public pages, release checks, adoption, and open issues before deciding whether to launch.
---

# Launch readiness

The launch decision stays with the owner. The report records observations and their sources. It has no effect on release gates or publication.

| Check | Green | Amber | Red |
| --- | --- | --- | --- |
| Public pages | Every URL in the deployed sitemap returns HTTP 200 and the title in the corresponding Pages build. | Site inventory, a built title, or a live response is unavailable. | A page returns another HTTP status or a different title. |
| Release demos | The recorded release matches the published version and the inventory verifies. | The release or its manifest is unavailable. | A version, inventory entry, or recorded digest differs. |
| Cold install | First output takes under 10 seconds on every supported OS and Node.js pair. | The clean-runner matrix is incomplete. | A required pair fails or takes at least 10 seconds. |
| Documentation and README | Complete launch documentation and README evidence passes. | Evidence is missing, belongs to a prior revision, or covers only scoped checks. | A required step fails on the checked revision. |
| Adoption | Stars, forks, dependents, npm downloads, and public workflow usage have recorded values. | One or more values are unavailable. | No minimum applies. |
| Scorecard | The recorded score is at least 6.0. | The relevant result is unavailable. | The score is below 6.0. |
| npm provenance | Provenance verifies for the released npm package. | Verification evidence is unavailable. | Verification fails. |
| Release attestation | The published release attestation verifies. | Verification evidence is unavailable. | Verification fails. |
| Open P0 bugs | Zero open issues carry both `bug` and `priority: P0`. | The repository-wide count is unavailable. | At least one open issue carries both labels. |
| Open milestone issues | The selected milestone has zero open issues. | Open issues remain or the count is unavailable. | No issue-count limit applies. |

## Generate the report

Run from a checkout with Git and Node.js 22 or newer. Supply the GitHub milestone number from its URL. Milestone #1 tracks Offing 0.1.2.

```sh
npm run launch-readiness -- --milestone 1
```

The command writes a Markdown and JSON report dated in UTC under `metrics/launch-readiness/`. Pass `--out <directory>` to write elsewhere. The issue counts query public GitHub data and exclude pull requests. Adoption reads the latest eligible [weekly snapshot](../metrics/README.md) through the report date and links to the checked-out commit. Stars, forks, dependents, npm downloads, and public workflow usage each display the recorded count, including zero, or `unavailable`. The download row includes the recorded date range when present. The current weekly collector records stars, forks, and npm downloads.

Supply the extracted `docs-site` artifact from the Pages run that deployed the site, with its run ID. Extract it on a case-sensitive filesystem so paths such as `DETECTORS/` and `detectors/` remain distinct. [Pages runs](https://github.com/velella-sh/offing/actions/workflows/pages.yml)

```sh
npm run launch-readiness -- --milestone 1 --site-dir /path/to/docs-site --site-run RUN_ID
```

The check compares the artifact sitemap with the public sitemap, then checks the HTTP status and built title for every listed page. Both inputs must describe the same inventory. GET requests stay under the public Offing site, stop at redirects, and retry a transient gateway error once. The Markdown and JSON link to the sitemap, Pages build, and individual page discrepancies.

The release checks default to the latest published GitHub release. Pass `--version` with the exact version for a different published release. Scorecard compares its published repository score's commit to the release tag. The npm provenance and lifecycle attestation rows use the verification steps in the completed tag-push [Release run](https://github.com/velella-sh/offing/actions/workflows/release.yml). A skipped or missing verification is amber. Release demos use the [demo inventory](demos/manifest.json) at the checked-out commit and the version from the published GitHub release. The report links affected media or its source directory when the version, inventory or bytes differ. The gallery records historical and candidate-only files with their separate provenance.

Documentation reads the packed command step `acc-launch-docs` from [Package Smoke](https://github.com/velella-sh/offing/actions/workflows/package-smoke.yml) and the built link step from [docs doctor](https://github.com/velella-sh/offing/actions/workflows/docs-doctor.yml). It prefers completed runs for the checked-out commit. An earlier revision or a pull request check can provide prior evidence. Cancelled or skipped steps cannot confirm a result. A scoped pass leaves the row amber while the complete launch command, link and README checks remain open. A failure on the checked revision is red. The report links each observed step or its workflow when no result is available.

To include cold-install timings, download the per-runner artifacts from [First minute](https://github.com/velella-sh/offing/actions/workflows/first-minute.yml). Put each run's artifact directories in a subdirectory named `YYYY-MM-DD--RUN_ID`, using the workflow's UTC run date. Pass the parent directory to `--timing-dir`. The report uses the latest run through the report date and up to 14 days old with observations for the exact published npm version. It shows npm reify and first forecast times separately and uses the recorded 10-second gate. Candidate tarballs and expired or absent measurements leave missing evidence amber.

## Read the workflow report

[Launch readiness](https://github.com/velella-sh/offing/actions/workflows/launch-readiness.yml) runs Mondays at 08:41 UTC and after a release is published. Releases created by the repository token are picked up after the tagged Release run completes. The workflow links both report formats as an Actions artifact and refreshes one automation-owned pinned issue. Set the repository variable `OFFING_LAUNCH_READINESS_MILESTONE` to use a milestone other than #1. The issue and workflow have no effect on release publication or the owner's decision.
