---
title: Export the versioned forecast tool module
---

# 0084. Export the versioned forecast tool module

Expose `@velella/offing/forecast-tool` with `contractVersion` 1 and a typed
`run(input, context)` entry point. Consumers can process file or paste input
locally using a host-supplied copy of Offing's pinned signed Ebb data release.
Public GitHub selectors require the host to provide a separate fetch function
after user approval. This preserves the local input privacy boundary and lets
the module aggregate verified repository files into one forecast.

Successful runs use the existing forecast records v1 shape. Export the same
JSON Schema in npm for offline validation. Errors and repository selections
with no supported files return an empty list with a message. Mizzen and Lateen
host integration and conformance remain tracked in
[#565](https://github.com/velella-sh/offing/issues/565).
