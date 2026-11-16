---
title: Guard package installs
description: Check npm and PyPI dependencies against local lifecycle data before running the package manager.
---

# Guard package installs

Put `offing guard` before a supported install command. Offing checks the named registry packages against its local Ebb data. If the gate allows the install, Offing runs the manager from your PATH with its original arguments and returns the manager's exit code.

| Manager command | Example |
| --- | --- |
| `npm install`, `npm i`, `npm add` | `offing guard npm install request@2.88.2` |
| `pnpm add` | `offing guard pnpm add --save-dev request@2.88.2` |
| `yarn add` | `offing guard yarn add -D request@2.88.2` |
| `bun add` | `offing guard bun add --dry-run request@2.88.2` |
| `pip install` | `offing guard pip install --dry-run 'nose==1.3.7'` |
| `uv add` | `offing guard uv add 'nose==1.3.7'` |

Offing recognizes scoped npm names and uses the lower bound of a parseable npm version range. For PyPI, it normalizes names, strips extras from the package identity, and checks exact pins. It checks requirements with environment markers regardless of their conditions.

Use `-r` with a local UTF-8 requirements file for pip or uv. Nested includes are resolved relative to their containing file. This example is refused with the bundled Ebb rules.

```bash
printf '%s\n' 'nose==1.3.7' > guard-example.txt
offing guard pip install --dry-run -r guard-example.txt
```

The check covers explicit registry dependencies only. The manager still resolves versions, tags, transitive dependencies, aliases, and local or VCS installs. The requirements parser reads package lines and local includes. Constraint files, package indexes, and hash validation are handled by the manager.

## Flags and severity

Put Offing options before the manager name. Options after the manager name go to the manager.

| Flag | Effect |
| --- | --- |
| `--fail-on <severity>` | Set the minimum blocking severity for this invocation. Values in order are `info`, `low`, `medium`, `high`, and `critical`. `none` disables severity-based refusal. |
| `--allow <purl>` | Override the gate for this package URL for the current invocation. Include a version to limit the override to that version. Repeat the flag to allow additional packages. |
| `--force` | Override all refusals for this invocation and print a warning. |
| `--verbose` | Show all blocking findings and their details. |
| `--data-version <version>` | Select the lifecycle dataset. Use `bundled` for the copy that ships with Offing. |

Without `--fail-on`, Offing uses `failOn` from the nearest [repository configuration](CLI.md#scan) found from the current directory. The default is `high`.

## Results

With bundled data and the default severity, this dry run is refused with exit code 1.

```bash
offing guard --data-version bundled npm install --dry-run request@2.88.2
```

```text
offing guard: refused to run npm (1 blocked, --fail-on high).
pkg:npm/request@2.88.2 — request is deprecated
Replacement: Native fetch or a maintained HTTP client
Evidence: https://www.npmjs.com/package/request
Use --allow <purl> or --force before npm to override, or --verbose for details.
```

To let npm perform the dry run for that specific package, use a one-time allowance. Offing prints `--allow override used for pkg:npm/request@2.88.2`.

```bash
offing guard --data-version bundled --allow pkg:npm/request@2.88.2 npm install --dry-run request@2.88.2
```

A missing rule produces `no data for pkg:npm/express@4.18.0` and the manager proceeds if the rest of the install passes the gate. The message means Ebb lacks lifecycle data for the package.

```bash
offing guard --data-version bundled npm install --dry-run express@4.18.0
```

A known rule permits the install when the selected version falls outside the affected range, or when the severity is below the gate. This command lets npm perform the dry run because the finding for `request` is `high`.

```bash
offing guard --data-version bundled --fail-on critical npm install --dry-run request@2.88.2
```
