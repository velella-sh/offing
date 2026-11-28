---
title: Offing FAQ
---

# Offing FAQ

## Where do the lifecycle rules come from?

[Ebb](https://velella.sh/offing/launch/offing-and-ebb/) maintains rules based on sources such as vendor
support schedules and registry notices. Offing ships a copy and can use
[verified data updates](https://velella.sh/offing/DATA/).

## Does Offing send my files anywhere?

Local scans read repository files and lifecycle data on your machine. A
package installation may contact npm. The [privacy guide](https://velella.sh/offing/PRIVACY/)
lists what other commands and integrations read, write, and send.

## What does `no-data` mean?

Offing has no applicable lifecycle rule for the package. Use the project's
own support or release information to assess it. With bundled data, this
example prints `Status: no-data`.

```bash
offing check pkg:npm/express@4.18.0 --data-version bundled
```

## How do I report a false positive?

Check the rule ID, evidence URL, exact file and line, and data version in the
result. [Report a problem](https://velella.sh/offing/SUPPORT/) with those details and a small
sanitized reproduction. See [rule evidence](https://velella.sh/offing/RULES/) for how Offing
matches versions and records sources.

## Why is an event listed under “elsewhere”?

Its date falls in the forecast window. Offing did not match the affected
version in the selected repository. The [forecast guide](https://velella.sh/offing/launch/forecast-in-30-seconds/)
shows how to read a matched event.

## Why does the date or outcome differ between two runs?

Check the Offing version, lifecycle data version, and forecast reference
date. Use `offing data status` to inspect the dataset and `--as-of` to
repeat a forecast from a fixed date. See [pinning](https://velella.sh/offing/DATA/#pinning).

## Does a refusal edit the project for me?

A pre-write refusal stops that proposed edit and can show a replacement.
You or the agent choose what to write next. See the
[guard guide](https://velella.sh/offing/launch/guard-in-one-command/).

## Where do I see a hook's output?

The host controls where it shows pre-write decisions or after-edit
feedback. See the [host guides](https://velella.sh/offing/guides/) and
[troubleshooting steps](https://velella.sh/offing/launch/TROUBLESHOOTING/).

## What should I inspect when Autopilot stops before verification?

The accepted diff remains in its isolated Git worktree. Read the stop
reason and compare the worktree diff with the recorded test results before
choosing whether to resume. A stopped run can contain edits that still need
verification. Follow the [recorded migration walkthrough](https://velella.sh/offing/launch/let-autopilot-do-the-upgrade/).

## Does an empty Fleet forecast mean every repository was checked?

Check the recorded repository statuses and the reference date. Failed and
skipped scans reduce coverage. A scanned repository can have a deadline
that already passed, which falls outside the upcoming buckets. The
[Fleet walkthrough](https://velella.sh/offing/launch/every-repository-at-once/) shows how to check coverage and the forecast date in one capture.

## What should my release job verify before trusting a lifecycle attestation?

Compare the statement's subject digest with the artifact you intend to
ship. Verify the signer, workflow and source revision against independently
trusted values, then evaluate the recorded lifecycle observations for the
release date. Follow the [artifact and release gate walkthrough](https://velella.sh/offing/launch/prove-what-you-ship/).
