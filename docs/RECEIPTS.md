---
title: Verification receipts
---

# Verification receipts

A verification receipt records what a change resolved, left, or introduced.
Save a JSON scan outside the repository before making the change, then
produce the versioned [verification result](https://velella.sh/offing/spec/verify/v1/):

```bash
offing scan . --json > /tmp/before.json
# Make and check the migration.
offing receipt . --before /tmp/before.json --format verify-result > /tmp/verification.json
offing scan . --json > /tmp/after.json
node check.mjs /tmp/verification.json /tmp/before.json /tmp/after.json
```

Download [check.mjs](https://velella.sh/offing/spec/verify/conformance/check.mjs)
to validate the JSON. Use the same scan options and data for both sides when
you want to isolate the effect of code changes. `--fail-on-introduced` makes
the receipt command exit 1 when the change introduces a finding.

`offing fix . --branch --json` applies deterministic fixes on a local branch,
commits them, and prints the same verification document. This command keeps
the commit local. Through the local MCP server, `verify_migration` supplies
the common document as `verifyResult` alongside its existing fields whenever
it fits the tool response.

## Paste into a pull request

Run `offing receipt . --before /tmp/before.json` for a Markdown receipt, or
paste the MCP `receipt_markdown` field. The human-readable summary shows
findings and suggested commands. Look for the JSON fence immediately after
`<!-- offing-verify-result:v1 -->` for the machine-readable document.

For a large comparison, the receipt prints an artifact reference. Save the
full JSON as `offing-verify-result.json` using `--format verify-result`,
attach it to the associated run, and include a link to that run.

`--format json` and `--json` still print the deprecated
`offing.receipt.v1` document. See the [stability policy](https://velella.sh/offing/STABILITY/) for the
deprecation window. Offing compares the scans locally and leaves suggested
commands for you to run. The separate `offing verify` command checks the
integrity of the installed Offing release.
