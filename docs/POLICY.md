---
title: Lifecycle policy
description: Turn lifecycle findings into named CI gates with a lookahead and time-limited exceptions.
---

# Lifecycle policy

Put `policy` in the repository's `.offing.json`. Run `offing config validate` to check it and
`offing scan` to apply it. The GitHub Action reads the same policy from its scan root and
uses workspace-relative finding paths for a scan with `paths`. In diff mode it evaluates
introduced findings. Set `fail-on-severity: none` in the Action to use only configured
policy rules.

The scan evaluates policy after the existing scan filters and baseline suppressions. A
match fails with exit code 1. Text names the rule and finding. JSON contains
`policy.violations` with the rule ID, finding ID, and path. It includes the reason and date
when an expired exception matched. A passing evaluation has an empty violations list.

- `id` names the rule in the report. Start with a letter or digit and use letters, digits,
  underscores, or hyphens.
- `days-left` includes dated findings at or before the UTC reference day plus the specified
  number of days, including past deadlines. Use an integer from 0 to 3650.
- `after-eol: true` matches deadlines on or before the reference day. Use `false` for future
  deadlines. A finding without a deadline matches neither.
- `severity` sets the minimum matching severity. `ecosystem` accepts a detector ID or rule
  prefix, as in `--only`. `path` accepts the same path and glob syntax as `ignore`.
- Conditions on a rule must all match. Each exception needs a path or ecosystem, a reason,
  and an `expires` date in `YYYY-MM-DD`. A matching exception applies to explicit policy
  rules through its expiry day. If both an active and expired exception match the same
  violation, the expired exception takes precedence.

Use `--as-of YYYY-MM-DD` or `--today YYYY-MM-DD` to reproduce a decision. Configured
`failOn` and `--fail-on` retain their existing severity gate, including flag precedence.
`--min-support-days` continues to raise upcoming findings to warning severity. Explicit
policy exceptions leave those legacy gates unchanged.

## Plan upgrades in services

Fail for upcoming deadlines within 90 days anywhere under a `services` directory. The
future-only condition keeps this rule focused on planned work.

<!-- offing-config: valid -->
```json
{
  "policy": {
    "rules": [
      { "id": "upgrade-services", "days-left": 90, "after-eol": false, "path": "services/" }
    ]
  }
}
```

## Gate ended npm dependencies

Fail once a dated npm finding reaches end of life. Grant one directory an exception until
its scheduled migration.

<!-- offing-config: valid -->
```json
{
  "policy": {
    "rules": [{ "id": "ended-npm", "after-eol": true, "ecosystem": "npm" }],
    "exceptions": [
      {
        "path": "packages/legacy/",
        "ecosystem": "npm",
        "reason": "Replacement rollout scheduled",
        "expires": "2027-03-31"
      }
    ]
  }
}
```

## Block high-severity findings in GitHub workflows

Keep the scope narrow and apply the gate to undated findings as well.

<!-- offing-config: valid -->
```json
{
  "policy": {
    "rules": [{ "id": "workflow-lifecycle", "severity": "high", "path": ".github/workflows/" }]
  }
}
```

## Move from xeol

For xeol's `--lookahead 90d --fail-on-eol-found`, use `offing scan --lookahead 90d`.
It adds a blocking `days-left` rule alongside configured rules and accepts whole days,
weeks of 7 days, and years of 365 days. Use `--lookahead 0d` to gate dated findings already
at end of life. To translate xeol's lookahead-only scan into an Offing warning, use
`--min-support-days 90`. That preserves the scan's report and raises the severity of
upcoming findings within the window. [xeol lookahead and gating](https://github.com/xeol-io/xeol#lookahead)
