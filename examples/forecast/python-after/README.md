# Python after

The patch moves the runtime pin to Python 3.11. A manual change switches the header parser to `email.message` and removes the Python 3.13 upgrade blocker.

```bash
NO_COLOR=1 node dist/tools/examples.js forecast/python-after forecast --as-of 2025-09-01 --months 3
node dist/tools/examples.js forecast/python-after upgrade-check --to python@3.13
```
