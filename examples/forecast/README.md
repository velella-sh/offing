# Forecast examples

These tiny repositories go from `Weather: storm` to `Weather: clear` after migration. Each pair replays a three-month forecast from a fixed date just before its own deadline.

| Example | As of | Before | After |
| --- | --- | --- | --- |
| Node.js | 2026-02-01 | [Project](node-before/) · [Forecast](node-before/forecast-before.txt) | [Project](node-after/) · [Forecast](node-after/forecast-after.txt) |
| Python | 2025-09-01 | [Project](python-before/) · [Forecast](python-before/forecast-before.txt) | [Project](python-after/) · [Forecast](python-after/forecast-after.txt) |
| GitHub Actions | 2026-08-01 | [Project](actions-before/) · [Forecast](actions-before/forecast-before.txt) | [Project](actions-after/) · [Forecast](actions-after/forecast-after.txt) |

From the Offing checkout, run `npm ci` and `npm run build`, then use the commands in each project. The example runner restores fixture filenames in a temporary copy. It does not install or run anything in the samples.

To try the patch yourself, materialize a copy first. For example:

```bash
cli="$PWD/dist/src/cli.js"
sample=$(node dist/tools/examples.js forecast/actions-before)
(cd "$sample" && node "$cli" fix . > fix.patch && git apply fix.patch)
NO_COLOR=1 node "$cli" forecast "$sample" --as-of 2026-08-01 --months 3
```

`fix` prints the changes it can make safely. The Node.js and Python examples also show manual migrations. Forecasts report dated events in their window, not every lifecycle finding; the before READMEs show how to see the other risks.
