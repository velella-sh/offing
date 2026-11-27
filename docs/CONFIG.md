---
title: Offing configuration
description: Validate Offing configuration locally, enable editor completion, and block invalid changes in pre-commit.
---

# Offing configuration

Put a `.offing.json` file in the repository root. Offing searches upward from the project directory and stops
at the Git root. Set `$schema` to the [published config schema](https://raw.githubusercontent.com/velella-sh/offing/main/schemas/config.v1.schema.json)
to get key and value completion in VS Code and other JSON Schema-aware editors.

<!-- offing-config: valid -->
```json
{
  "$schema": "https://raw.githubusercontent.com/velella-sh/offing/main/schemas/config.v1.schema.json",
  "failOn": "high",
  "ignore": ["dist/**"]
}
```

## Validate a file

```sh
offing config validate
offing config validate path/to/custom.json
offing config validate --json
```

Without a path, Offing searches from the current directory. A repository with no config passes. An explicit
path can name a JSON file or a project directory. An explicit file that cannot be read or a directory with no
discoverable config exits 2. Invalid config also exits 2. For valid config the exit code is 0, including when
there are deprecation warnings. The validator reads the bundled schema offline. `offing doctor` reports the
same diagnostics when it finds a config.

For example, save this invalid config to a temporary JSON file and pass that path to the validator.

<!-- offing-config: invalid -->
```json
{
  "failOn": "urgent",
  "ignorePaths": ["dist/**", 3, " "],
  "unknown": true
}
```

Offing reports the invalid severity, both invalid ignore entries, and the unknown key. It also warns that
`ignorePaths` is deprecated. Each diagnostic gives the file, one-based line and column, and a suggested fix.
Replace `ignorePaths` or `ignore-paths` with `ignore`. If several spellings are present, retain the effective
value under `ignore`. Each supplied spelling must have a valid value.

Use `--json` to get [`offing.config-validation.v1`](https://raw.githubusercontent.com/velella-sh/offing/main/schemas/config-validation.v1.schema.json)
on standard output. Diagnostics are in source order. The `pointer` field is a JSON Pointer, with an empty string
for document-level problems. Check `valid` or the exit code. Diagnostic codes and severity are intended for scripts.
The message and suggestion are intended for people.

## Block invalid config in pre-commit

Add this entry to `.pre-commit-config.yaml` and run `pre-commit install`. Pin the hook to a release that includes
`offing config validate`.

```yaml
repos:
  - repo: https://github.com/velella-sh/offing
    rev: v0.1.2
    hooks:
      - id: offing-config
```

The hook runs when the root `.offing.json` changes. Run `pre-commit run offing-config --all-files` to check it on demand.

## Gate lifecycle findings

Use [lifecycle policy](https://velella.sh/offing/POLICY/) to fail scans on named deadline,
severity, ecosystem, or path conditions and document time-limited exceptions.
