---
title: Version and environment files
description: Scan runtime pins in asdf and mise files, npm devEngines, and Conda environments.
---

# Version and environment files

Run `offing scan .` to check runtime and package declarations against the bundled Ebb rules. Findings link to the file and declaration line. Offing reads the files without running the version manager or resolving versions over the network.

## asdf

Offing reads the existing `.tool-versions` entries using each detector's version rules. Some runtimes use the first version and others check all the fallback versions on the line.

```text
python 3.9.25
ruby 3.2.2 3.3.0
```

## mise

Use `mise.toml` or `.mise.toml` with a `[tools]` table. Its supported tool names are `node` (also `nodejs`), `python`, `ruby`, `php`, `elixir`, `erlang`, `deno`, `bun`, and `terraform`. A tool value can be a version string, an inline table with a `version` string, or an array of those forms. Offing reports against the tool assignment line.

```toml
[tools]
node = ["18.20.8", "lts"]
ruby = { version = "3.2.2" }
```

For that file, `offing scan . --json` emits a Node.js 18 lifecycle finding at line 2. It also lists `lts` as an unclassified reference with a `no-data` reason. Moving aliases such as `lts`, `latest`, and `system` need resolution by the version manager before Offing can judge their lifecycle. Offing scans literal entries and skips unrecognized tool names and custom backends.

## npm

In `package.json`, each of `devEngines.runtime` and `devEngines.packageManager` accepts an object or array. Offing checks Node.js runtime ranges and concrete Bun and Deno versions. A declaration with no usable version or matching runtime data can appear as an unclassified reference.

```json
{
  "devEngines": {
    "runtime": { "name": "node", "version": "18.x" },
    "packageManager": { "name": "bun", "version": "1.0.29" }
  }
}
```

## Conda

Offing checks the Python declaration in `dependencies` and Python package requirements in its nested `pip` list in `environment.yml` and `environment.yaml`. It uses the same package rules as it does for requirements files.

```yaml
name: example
channels:
  - conda-forge
dependencies:
  - python=3.8
  - pip
  - pip:
      - nose==1.3.7
```
