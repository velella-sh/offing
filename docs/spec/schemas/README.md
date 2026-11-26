---
title: JSON schema conformance
description: Verify the published Offing schema catalog from a clean consumer environment.
---

# JSON schema conformance

Download the [standalone checker](check.mjs) and run `node check.mjs` with
Node.js 22 or newer. It reads the public catalog and fetches each declared
schema URL. It checks the identifiers, legacy aliases, and schema references,
including references to individual fields. No Offing checkout or npm install
is required.

To check a staged site build, use
`node docs/spec/schemas/check.mjs --directory docs/_site/schemas`. In
the repository, `npm run check` also validates representative CLI and MCP output
against the packaged schemas.
