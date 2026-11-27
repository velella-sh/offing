---
title: Fleet policy
description: Apply an organization policy to local repository scans and GitHub Actions.
---

# Fleet policy

Run `offing policy validate` from a repository containing an `extends` entry. See the [fleet policy v1 specification](https://velella.sh/offing/spec/fleet-policy/v1/) for the fields and precedence rules.

A local policy can live at `policies/organization.json` under the repository root. Set `"extends": "policies/organization.json"` in `.offing.json`, then run:

```sh
offing policy validate
offing policy explain runtime
offing scan .
```

For a shared policy, set `extends` to `github:example/.github/.offing-policy.json@<commit>` with a real commit SHA. Run `offing policy pull` to validate and cache the pin. Later scans use the cached copy. `offing scan --policy-online` explicitly refreshes the selected reference. The Action `policy` input accepts the same syntax and an already populated cache.

Add an owner, reason, expiry, and path or ecosystem scope to each exception. An organization must list `"exceptions"` in `allowLoosen` before team and repository layers can add exceptions.

The [templates](https://github.com/velella-sh/offing/tree/main/templates/fleet-policy) illustrate an organization-wide gate, an explicit team layer, and a time-limited exception. Pass a template path to `offing policy validate --policy <path>` to see the effective rules for your repository.
