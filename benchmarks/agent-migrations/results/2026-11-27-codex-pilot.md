# Codex migration pilot

On 2026-11-27, Codex CLI `0.171.0-alpha.13.2` (model `gpt-6.2-sol`) migrated the outdated GitHub Actions setup-node runtime in a public checkout of [MDN HTTP Observatory](https://github.com/mdn/mdn-http-observatory/tree/1c41f2043a03c3ab953a65cf184b7fa6b8c2af2f). The known upstream fix is [7755cf17](https://github.com/mdn/mdn-http-observatory/commit/7755cf17c33c1aa3d4a85059600fef9790b8b4d6). The two attempts used separate worktrees at the same pinned commit.

| Condition | Agent wall time | Resolved | Introduced findings | Static verification |
| --- | ---: | --- | --- | --- |
| Baseline prompt | 22.260 s | Yes | 0 | Passed |
| Migration packet | 22.639 s | Yes | 0 | Passed |

Each attempt edited only `.github/workflows/build-and-test.yml`. Offing rescanned the complete checkout after each run. A read-only container with networking disabled verified that the workflow used setup-node v5 or later and that the v4 reference was absent. The container ran Node from `node@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`. Project-test status was `not-run`. Both agents exited normally and the source checkout stayed clean.

The shipping `offing migrate` route was also exercised with the same installed Codex CLI and pinned checkout. It wrote a local commit `df8231da3f86` changing only the matching workflow, preserved the source checkout's clean status and wrote the same `offing.verify-result.v1` to the standalone receipt and commit trailer. The rescan resolved one finding and introduced zero. Suggested project commands were recorded as `not-run`.
