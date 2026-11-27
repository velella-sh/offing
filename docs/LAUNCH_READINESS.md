---
title: Launch readiness
description: Read evidence about public pages, release checks, adoption, and open issues before deciding whether to launch.
---

# Launch readiness

The launch decision stays with the owner. The report records observations and their sources. It has no effect on release gates or publication.

| Check | Green | Amber | Red |
| --- | --- | --- | --- |
| Public pages | Every URL in the deployed sitemap returns HTTP 200 and the title in the corresponding Pages build. | Site inventory, a built title, or a live response is unavailable. | A page returns another HTTP status or a different title. |
| Release demos | Every recorded demo names the released version. | There is no verified demo manifest for the release. | Recorded media is missing or built for a different version. |
| Cold install | First output takes under 10 seconds on every supported OS and Node.js pair. | The clean-runner matrix is incomplete. | A required pair fails or takes at least 10 seconds. |
| Documentation and README | All required command, link, and README checks pass. | At least one required result is unavailable. | A required check fails. |
| Adoption | Stars, forks, dependents, npm downloads, and public workflow usage have recorded values. | One or more values are unavailable. | No minimum applies. |
| Scorecard | The recorded score is at least 6.0. | The relevant result is unavailable. | The score is below 6.0. |
| npm provenance | Provenance verifies for the released npm package. | Verification evidence is unavailable. | Verification fails. |
| Release attestation | The published release attestation verifies. | Verification evidence is unavailable. | Verification fails. |
| Open P0 bugs | Zero open issues carry both `bug` and `priority: P0`. | The repository-wide count is unavailable. | At least one open issue carries both labels. |
| Open milestone issues | The selected milestone has zero open issues. | Open issues remain or the count is unavailable. | No issue-count limit applies. |

## Generate the report

Run from a checkout with Git and Node.js 22 or newer. Supply the GitHub milestone number from its URL. For example, milestone #2 tracks Offing 0.1.9.

```sh
npm run launch-readiness -- --milestone 2
```

The command writes a Markdown and JSON report dated in UTC under `metrics/launch-readiness/`. Pass `--out <directory>` to write elsewhere. The issue counts query public GitHub data and exclude pull requests. Adoption reads the latest eligible [weekly snapshot](../metrics/README.md) through the report date and links to the checked-out commit. The current weekly format records stars, forks, and npm downloads. Dependents and public workflow usage remain unavailable.

Supply the extracted `docs-site` artifact from the Pages run that deployed the site, with its run ID. Extract it on a case-sensitive filesystem so paths such as `DETECTORS/` and `detectors/` remain distinct. [Pages runs](https://github.com/velella-sh/offing/actions/workflows/pages.yml)

```sh
npm run launch-readiness -- --milestone 2 --site-dir /path/to/docs-site --site-run RUN_ID
```

The check compares the artifact sitemap with the public sitemap, then checks the HTTP status and built title for every listed page. Both inputs must describe the same inventory. GET requests stay under the public Offing site, stop at redirects, and retry a transient gateway error once. The Markdown and JSON link to the sitemap, Pages build, and individual page discrepancies.

Release demos, clean install, documentation and README, Scorecard, provenance, and attestation show amber until their released-version evidence is connected. Publishing and the tracking issue remain separate from this command.
