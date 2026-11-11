# Baseline fixtures

Baselines written by released versions of Offing, used to prove that a baseline never stops working after an upgrade.

| File | Written by | How |
| --- | --- | --- |
| `v0.1.0.json` | the published `@velella/offing@0.1.0` | `npx -p @velella/offing@0.1.0 offing baseline <dir> --output v0.1.0.json`, run on a copy of `tests/fixtures/smoke/package.json` |

Add a file here for each release that changes how baselines are written. Never edit an existing file: it is the record of what that release produced.
