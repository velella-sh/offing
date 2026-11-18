# Python before

This header parser pins [Python 3.9](../../../docs/rules/python.runtime.eol-3.9-and-older.md) and uses `cgi.parse_header`, [removed in Python 3.13](../../../docs/rules/python.module.cgi.removed.md).

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/python-before forecast --as-of 2025-09-01 --months 3
node dist/tools/examples.js forecast/python-before upgrade-check --to python@3.13
node dist/tools/examples.js forecast/python-before fix --dry-run
```

The forecast shows the runtime deadline. The upgrade check shows why the old API cannot move to Python 3.13. Apply the runtime patch and replace the header parser manually.
