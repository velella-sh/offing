---
title: Opt in to inline agent lifecycle reviews
---

# 0075 Opt in to inline agent lifecycle reviews

**Status:** Accepted

The Action's v1 inputs add `verify-agent-committers`, `agent-review` and
`review-event`. The scan stays local. After a diff scan, the host can read
GitHub's bot account and verified signature metadata for commits in the
scanned range. The read is optional and uses the job's pull request token.

Inline publication is a separate opt-in on ordinary, same-repository pull
requests. One review pins its comments to the scanned head, and comments
only attach to changed lines in the PR diff. Informational comments are the
default. Requesting changes requires the explicit `request-changes` choice.

When a built-in codemod can express the entire fix as a single suggestion
on changed lines, its replacement goes in the same inline comment.
The linked run artifact holds per-finding migration packets with
repository-relative paths and without source excerpts. The separate
pull request comment omits finding details successfully published inline.
The job summary, JSON report, and policy gates use the full scan.

This decision defines one submission per eligible run. Updating previous
reviews and resolving stale threads are tracked separately in #753.
