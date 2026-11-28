---
title: Package successor audit
description: Review replacement guidance in the npm and PyPI deprecation rules shipped in Ebb 0.2.0.
---

# Package successor audit

On November 28, 2026, Offing audited the npm and PyPI package deprecation rules in the released Ebb 0.2.0 tarball. The inputs match the rules installed by Offing's lockfile. The audit treats a rule as package-level when its event is `deprecated` and its Package URL starts with `pkg:npm/` or `pkg:pypi/`. This includes rules with import matchers and excludes Python standard-library symbols.

| Ecosystem | Package deprecation rules | With a replacement note | Without a replacement note |
| --- | ---: | ---: | ---: |
| npm | 63 | 60 | 3 |
| PyPI | 23 | 23 | 0 |

These are the rules without a replacement note. The evidence links point to the npm notices from those rules. Ebb owns the successor decision.

| Ebb rule | Package URL | Evidence |
| --- | --- | --- |
| `npm.package.har-validator.deprecated` | `pkg:npm/har-validator` | [Published package metadata](https://registry.npmjs.org/har-validator/latest) |
| `npm.package.nomnom.deprecated` | `pkg:npm/nomnom` | [Published package metadata](https://registry.npmjs.org/nomnom/latest) |
| `npm.package.protractor.deprecated` | `pkg:npm/protractor` | [Published package metadata](https://registry.npmjs.org/protractor/latest) |

[Ebb's structured replacement roadmap](https://github.com/velella-sh/ebb/issues/369) and its [npm](https://github.com/velella-sh/ebb/issues/421) and [Python](https://github.com/velella-sh/ebb/issues/423) tasks describe the upstream evidence requirements. A replacement note can point to a platform API, several alternatives, or a package. A manifest edit still needs a structured successor and a supported version range. [Offing's successor integration](https://github.com/velella-sh/offing/issues/430)

The existing import codemods cover `boom`, `cryptiles`, `sntp`, `koa-router` and `sourcemap-codec`. Their five successor names match the released Ebb guidance. The `acc-replacements` fixture checks those matches and the exact import diffs.

## Reproduce the audit

Fetch the exact [Ebb 0.2.0 tarball](https://registry.npmjs.org/@velella/ebb/-/ebb-0.2.0.tgz) in a scratch directory. Its SHA-256 is `27063827c7cc0e27a7533a520338d3079276671a19805eb221b6889664fbec79`. With that tarball in the current directory, run:

```bash
for ecosystem in npm python; do
  type=$ecosystem
  if [ "$ecosystem" = python ]; then type=pypi; fi
  tar -xOzf velella-ebb-0.2.0.tgz "package/registry/$ecosystem.json" |
    jq --arg type "$type" '
      [.rules[] | select(.event == "deprecated" and (.purl | startswith("pkg:" + $type + "/")))] |
      {rules: length, withNote: (map(select((.replacement // "") != "")) | length),
       missing: map(select((.replacement // "") == "") | {id, purl})}'
done
```

From an Offing checkout with dependencies installed, run `npm run build` and `node --test dist/tests/fix-codemods.test.js` to check the import codemods against bundled Ebb data.
