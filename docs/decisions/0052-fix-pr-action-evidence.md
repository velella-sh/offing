---
title: Add evidence and branch ownership checks to fix pull requests
---

# 0052 Add evidence and branch ownership checks to fix pull requests

**Status:** Accepted

The Action's v1 interface adds optional `fix-pr-labels`, `fix-pr-url` and `fix-pr-number` without changing the default scan. A fix PR carries the shared verification contract and links the full run artifact. Verification commands are recorded as suggested commands.

The fix branch is updated with a lease against the inspected tip. Any commit outside the default branch whose author, committer or subject fails the existing bot convention prevents publication. Full history is required to verify an existing branch. Labels are added through the pull request's issue endpoint so other labels are preserved.
