---
title: Simulate runtime upgrades
description: Compare runtime changes locally using known pins, blockers, and lifecycle dates.
---

# Simulate runtime upgrades

Compare proposed releases against a repository without changing its files.

```sh
offing forecast . --target nodejs@22 --target python@3.13 --effort
offing forecast . --target nodejs@22 --format markdown
offing forecast . --target nodejs@22 --json
```

The targets are separate simulations. Inspect the exact blocker and pin locations first, then compare the removed, retained and added deadlines. A target without a known date shows `no-data`. A verdict of `unknown` means lifecycle or compatibility evidence is missing. A `ready` result requires a known date for the target line and static evidence of compatibility. Builds, tests and deployments still need verification.

Use `--effort` to distinguish a deterministic change for the requested version, an assisted change with a migration packet, and work requiring manual judgment. Image variant names, digests and dynamic references can leave an image pin unresolved.

## Read a fleet recording

```sh
offing fleet my-organization --json --what-if-target nodejs@22 > fleet.json
offing forecast --fleet fleet.json --target nodejs@22 --json
```

The first command collects evidence while reading the pinned tree over the configured fleet host. The second reads the file offline. Each repository is assigned to one verdict for each target, with its saved commit and reason. A missing or stale observation stays unknown.

The MCP tool `simulate_upgrade` takes `repository_path`, `targets`, and optionally `as_of`, `months`, and `effort`. See the [v1 specification](spec/what-if/v1.md) for field meanings and conformance.
