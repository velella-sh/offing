# GitHub Actions after

The patch moves both actions to v5, which uses the Node.js 24 Actions runtime. It leaves the project's selected Node.js version unchanged.

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/actions-after forecast --as-of 2026-08-01 --months 3
```
