# Node.js before

This HTTP status checker pins [Node.js 20](../../../docs/rules/nodejs.runtime.eol-20.md) and uses the discontinued [`request`](../../../docs/rules/npm.package.request.deprecated.md) package.

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/node-before forecast --as-of 2026-02-01 --months 3
node dist/tools/examples.js forecast/node-before scan
node dist/tools/examples.js forecast/node-before fix --dry-run
```

The forecast shows the Node.js deadline; `scan` also shows the earlier `request` deprecation. Apply the runtime patch, then switch to native `fetch` and remove `request` from the manifest.
