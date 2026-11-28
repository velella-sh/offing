---
title: Verification receipts
---

# Verification receipts

A verification receipt records what a change resolved, left, or introduced.
## Verify one local edit

Use the [installed Offing CLI](INSTALL.md) from your checkout. To practice,
copy the [example workflow](https://github.com/velella-sh/offing/blob/main/examples/forecast/actions-before/.github/workflows/build.yml)
to `.github/workflows/build.yml` in a disposable repository. Keep existing
working-tree edits and choose a finding you can address without overwriting them.

Save the before scan outside the project before changing any files.

```bash
evidence_dir="$(mktemp -d)"
offing scan . --json > "$evidence_dir/before.json"
```

Open `before.json` and copy one exact `findings[].id`. If there are no
supported findings you can address, stop. A clean scan alone cannot verify
an edit. Replace `<finding-id>` with your selection, then check the rule, file
and official sources. Read the migration steps and constraints before editing.

```bash
finding_id='<finding-id>'
offing explain "$finding_id" . --json
offing context "$finding_id" . --json
```

Make the edit without committing. Review the diff and run any appropriate
project checks separately. Create the versioned
[verification result](https://velella.sh/offing/spec/verify/v1/) and save the
after scan with the same scan options and data.

```bash
offing receipt . --before "$evidence_dir/before.json" --format verify-result > "$evidence_dir/verification.json"
offing scan . --json > "$evidence_dir/after.json"
```

Look for the selected ID under `resolved` or `remaining` and check the
`introduced` list for new findings. A zero exit status alone does not show
that the finding was fixed. `--fail-on-introduced` makes the receipt command
exit 1 when a change introduces a finding. Offing reports suggested project
checks as `not-run`. Record separately which checks you ran and whether they
passed, failed, or were skipped.

Download [check.mjs](https://velella.sh/offing/spec/verify/conformance/check.mjs)
and run the independent checker on the saved results.

```bash
node check.mjs "$evidence_dir/verification.json" "$evidence_dir/before.json" "$evidence_dir/after.json"
```

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
