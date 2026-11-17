# False positives in the forecast review

The [finding labels](labels.json) record the pinned declaration, displayed date, cited source, and vendor evidence for each wrong result. All 13 wrong findings are covered by [Ebb #626](https://github.com/velella-sh/ebb/issues/626).

| Cause | Wrong findings | What the vendor evidence showed |
| --- | ---: | --- |
| Node.js 20 rule includes `actions/upload-artifact@v6` | 5 | v6 already runs on Node.js 24. [v6.0.0 release](https://github.com/actions/upload-artifact/releases/tag/v6.0.0) |
| One artifact rule uses the runtime deadline for the retired v3 artifact service | 1 | GitHub.com stopped supporting the v3 service on 2025-01-30. [GitHub announcement](https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/) |
| Grouped Python and container rules give older releases the same date as a more recent one | 7 | Python 3.8, Node.js 12, MySQL 5.6, Alpine 3.14 and 3.19, and Go 1.21 each had earlier vendor dates. [Pinned examples and sources](https://github.com/velella-sh/ebb/issues/626) |

The snapshots retain the flagged findings until the authoritative data is corrected. Several declarations are genuinely unsupported, but their dates fall into the wrong forecast window.
