---
title: Onboarding GitHub App
description: What the Offing onboarding app does before you install it — permissions, the pull request it opens, how to uninstall, and privacy.
---

# Onboarding GitHub App

The Offing GitHub App opens one reviewed pull request per selected repository. That pull request adds a SHA-pinned Offing workflow and config so lifecycle scans run in your own Actions. Read this page before you install: it covers the permissions GitHub will show, what lands in the pull request, how to remove everything, and what the app does with your code.

Install when a public listing is available (see [Distribution status](DISTRIBUTION.md)). Until then, the source and operator notes live under [`integrations/github-app/`](https://github.com/velella-sh/offing/tree/main/integrations/github-app). For a workflow you add by hand, use the [GitHub Action](GITHUB_ACTION.md) instead.

## What happens on install

1. You install the app on an account or organization and pick the repositories it may access.
2. For each selected repository that does not already have `.github/workflows/offing.yml`, the app opens one pull request from the branch `offing/onboarding`.
3. You review and merge (or close) that pull request. Nothing is pushed to the default branch without your review.
4. After merge, scans run in *your* repository's GitHub Actions. The app does not run the scan itself.

If the workflow file is already present, the app skips that repository. Adding more repositories to an existing install opens the same pull request for each new one that still lacks the workflow.

## Permissions

GitHub shows these permissions at install time. They match [`integrations/github-app/manifest.json`](https://github.com/velella-sh/offing/blob/main/integrations/github-app/manifest.json):

| Permission | Access | Why |
| --- | --- | --- |
| Contents | Read and write | Create the `offing/onboarding` branch and the proposed files |
| Pull requests | Read and write | Open the onboarding pull request |
| Metadata | Read | Required for repository identity |

The app listens only for `installation` and `installation_repositories` events. It does not ask for issues, checks, Actions, or organization administration. A later decision may tighten this set; until then, treat the table above as the contract you accept when you install.

## What the pull request contains

Title: **Add Offing lifecycle scan**. Branch: `offing/onboarding`.

| Path | Role |
| --- | --- |
| `.github/workflows/offing.yml` | Pull-request and `main` workflow with SHA-pinned `actions/checkout` and `velella-sh/offing`, `contents: read`, and a `high` severity gate |
| `.offing.json` | Config that points at `.offing-baseline.json` and sets the same gate; monorepos also ignore common generated trees |
| `README.md` | Optional Offing badge snippet merged in when a README exists |

The first Action run on that pull request proposes a baseline so existing findings do not fail the gate on day one. Offing never writes the baseline into your repository for you; you add it from the pull request comment if you want those findings accepted. Details: [GitHub Action](GITHUB_ACTION.md).

## How to uninstall

**Before merge.** Close or decline the onboarding pull request. Uninstall the app from the repository or organization settings so it does not open another one.

**After merge.** Delete `.github/workflows/offing.yml` and `.offing.json`, remove any Offing badge line from `README.md`, and uninstall the Offing GitHub App from the repository settings.

Uninstalling the app stops future onboarding pull requests. It does not delete files already merged; remove those yourself if you no longer want the scan.

## Privacy

- The handler is **stateless**: it verifies the webhook signature, uses a short-lived installation token, writes the proposed files through the GitHub API, and keeps no repository contents after the request ends.
- Scans still run on GitHub-hosted (or your self-hosted) runners in *this* repository. The app does not store your code, run detectors, or send findings to an Offing service.
- Repository analysis stays offline inside the Action, the same as a workflow you add by hand. See [Privacy](PRIVACY.md) and [GitHub Action — permissions and privacy](GITHUB_ACTION.md#permissions-and-privacy).
