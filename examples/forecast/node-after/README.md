# Node.js after

The patch moves the runtime pin to Node.js 24. A manual change switches the status check to native `fetch` and removes the `request` dependency.

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/node-after forecast --as-of 2026-02-01 --months 3
```
