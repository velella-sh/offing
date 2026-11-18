# GitHub Actions before

Two workflows use [checkout v4](../../../docs/rules/github-actions.checkout.node20.md) and [setup-node v4](../../../docs/rules/github-actions.setup-node.node20.md), both built for the retired Node.js 20 Actions runtime.

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/actions-before forecast --as-of 2026-08-01 --months 3
node dist/tools/examples.js forecast/actions-before fix --dry-run
```

Both workflows are fixtures. GitHub does not run workflows nested under `examples/`.
