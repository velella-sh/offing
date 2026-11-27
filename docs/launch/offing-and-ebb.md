---
title: How Offing uses Ebb
---

# How Offing uses Ebb

Ebb maintains lifecycle rules and their evidence. Offing reads a repository,
matches its files and versions against local Ebb data, and reports what it
found and where. Each release ships a bundled dataset. See the
[data guide](https://velella.sh/offing/DATA/) for signed updates, data pins, and the cache.

Try the [guard example](https://velella.sh/offing/launch/guard-in-one-command/) or inspect the same
package directly.

```bash
offing check pkg:npm/request@2.88.2 --data-version bundled
```

The result points to the [npm notice](https://www.npmjs.com/package/request).
The rule `npm.package.request.deprecated` is in the
[Ebb 0.2.0 npm registry](https://github.com/velella-sh/ebb/blob/v0.2.0/registry/npm.json).

Report an incorrect deadline, version range, or evidence source in
[Ebb](https://github.com/velella-sh/ebb/issues). Report an incorrect match,
file location, or output in [Offing](https://github.com/velella-sh/offing/issues).
Include the rule ID and the result of `offing data status`.
