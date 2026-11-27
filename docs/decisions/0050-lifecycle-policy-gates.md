---
title: Report explicit lifecycle policy violations
---

# 0050. Report explicit lifecycle policy violations

Add optional named `policy.rules` and expiring `policy.exceptions` to
`offing.config.v1`. Use the same evaluator in the CLI and GitHub Action, with UTC
dates and the scanner's path and ecosystem selectors. It evaluates the visible
findings after the scanner's existing filters and baselines. Expired exceptions
surface as violations and can name the former reason.

Add the optional `policy.violations` field to `offing.scan.v1`. Each violation
identifies the rule, finding and path, with optional expired-exception evidence.
Scans without an explicit policy retain their existing output shape. Severity
gates and minimum-support warnings preserve their legacy behavior. The CLI
`--lookahead` flag adds a blocking deadline rule without mutating any finding.
