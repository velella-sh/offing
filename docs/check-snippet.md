---
title: Check a snippet before writing
description: Check proposed code and configuration offline and get evidence-backed lifecycle replacements.
---

# Check a snippet before writing

Use `offing check-snippet` or the MCP tool `check_snippet` to check the proposed contents of one file. Pass the intended repository-relative path and the exact file text. The filename and directory decide which rules apply. For example, give GitHub Actions workflows a path under `.github/workflows/`.

Offing checks the input locally in isolation. It cannot resolve dependencies, imports, runtime pins, or template values from other files. For a version-specific migration, compare the rule's evidence with the actual runtime your project targets.

## Supported rule kinds

| Kind | Inputs | Examples of findings |
| --- | --- | --- |
| Node.js API usage | JavaScript and TypeScript source files | Deprecated `new Buffer`, removed `crypto.createCipher`, and other usages in Ebb's Node.js registry |
| Python API usage | `.py` files | Removed `imp` imports and deprecated `datetime.utcnow()` calls |
| Kubernetes APIs and Helm references | Kubernetes YAML, Kustomize declarations, and Helm chart metadata | Removed `extensions/v1beta1` Ingress and the old Helm stable repository |
| GitHub Actions references, runtimes and workflow commands | Workflow YAML and action metadata | Old Action versions, expired runner or runtime pins, and `::set-output` |
| Container and CI images | Dockerfiles, Compose, and supported CI configs | End-of-life base and runner images |
| npm and Python dependencies and runtimes | Manifests, supported lockfiles, runtime pins, and CI configuration | Deprecated dependencies and end-of-life Node.js or Python release lines |
| Other language and build dependencies | Standalone files supported by the Android, C and C++, Dart, Deno, .NET, Elixir, Go, Java, PHP, Ruby, Rust, Scala, and Swift detectors | Deprecated packages, unsupported toolchains, and retired build settings |
| Infrastructure and runtimes | Database configs, serverless configs, shell scripts and pins, and Terraform declarations | Deprecated database versions or shell features, retired cloud runtimes, and unsupported provider versions |
| Maintainer CLE declarations | A CLI or MCP snippet contains one file | CLE findings require an installed package and its manifest in the same scan, so this rule kind requires a repository scan |

The [detector reference](DETECTORS.md) lists recognized files for each ecosystem.

Offing parses Node.js and Python usages as code. Comments and string literals do not count as API usage. For module-specific rules, include the relevant import or require in the snippet. Alias resolution is limited to what is visible in the file.

## CLI

With Offing installed, run these examples in a shell:

```sh
printf '%s\n' 'const data = new Buffer(8);' | offing check-snippet --path src/data.ts --json
```

```sh
printf '%s\n' 'from datetime import datetime' 'value = datetime.utcnow()' | offing check-snippet --path timeutil.py
```

```sh
offing check-snippet --path .github/workflows/ci.yml <<'YAML'
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: echo "::set-output name=result::ok"
YAML
```

A successful check exits zero, including when findings are present. Use the JSON output to act on findings programmatically.

## MCP and JSON output

Call `check_snippet` on an [Offing MCP server](MCP.md) with these arguments:

```json
{
  "path": "deploy/ingress.yaml",
  "content": "apiVersion: extensions/v1beta1\nkind: Ingress\nmetadata: {name: demo}\n"
}
```

The JSON response has `schemaVersion` (`offing.check-snippet.v1`), `path`, `findings` and `message`. Each finding keeps its rule ID, detector, severity, evidence and snippet-relative location and includes these fields:

| Field | Meaning |
| --- | --- |
| `code` | The source line at the finding, trimmed to 240 characters |
| `replacement` | The reviewed replacement from the data, or `null` when the rule supplies none |
| `source` | The first authoritative reference, also included in `sources` |

A replacement can be a code fragment, a version, or an environment-file name. Review the finding's evidence and any migration guidance before applying it. An empty array means no rule matched.

## Agent hooks

Install or refresh the [edit hooks](HOOKS.md) to check proposed writes in Claude Code, Codex, or Cursor. Findings at or above the hook gate (`medium` by default) block the tool call and include any replacement. The hook checks full writes and edits it can reconstruct from the host's payload. An unreadable source file, an unsupported payload, or an unavailable check lets the tool proceed.
