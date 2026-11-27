# Vendored schemas

These files are copied unchanged from their publishers so tests can validate Offing's output without the network. They are test inputs: `package.json` leaves this directory out of the npm package.

| File | Source | SHA-256 |
|---|---|---|
| `sarif-2.1.0.json` | [OASIS SARIF 2.1.0 JSON schema](https://github.com/oasis-tcs/sarif-spec/blob/main/sarif-2.1/schema/sarif-schema-2.1.0.json) (the `errata01` schema, JSON Schema draft-04) | `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e` |
| `mcp-server-2025-12-11.json` | [MCP Registry `server.json` schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) (JSON Schema draft-07) | `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0` |
| `rdjson-diagnostic-result.json` | [reviewdog `DiagnosticResult` schema at commit `34a54e5b85daba36f973c910b1a6df937ebf37bc`](https://raw.githubusercontent.com/reviewdog/reviewdog/34a54e5b85daba36f973c910b1a6df937ebf37bc/proto/rdf/jsonschema/DiagnosticResult.json) (same bytes at release tag `v0.21.2`; JSON Schema draft-04, self-contained) | `89b09042bc3f833f76c502ab793ee4fceba4bb75919498563b17f2be68569970` |
| `cle-1.0.0.schema.json` | [CLE 1.0 JSON Schema](https://tc54.org/schemas/cle/cle-1.0.0.schema.json) (ECMA-428; JSON Schema draft 2020-12). License notice: `cle-1.0.0.NOTICE`. | `7023b8991005a2af6a4cc8b5eedae63d9c7646fca9dd2e225142a9e5fd6624f9` |
| `spdx-3.0.1-json-schema.json` | [SPDX 3.0.1 JSON schema](https://spdx.org/schema/3.0.1/spdx-json-schema.json) (JSON Schema draft 2020-12, line endings normalized to LF) | `571dd17d52ad567cb5b44c2fdf0c57f013d08584f00e4f30b4f744dcca0fbb4c` |

To refresh a file, download it again, update the hash here, and run `npm run check`. The SARIF schema is draft-04 and carries a top-level `id`, which Ajv's draft-07 mode rejects; `tests/sarif.test.ts` removes that one keyword in memory before compiling and leaves the file itself untouched.

The SPDX 3.0.1 schema is credited to the SPDX Working Group. Copyright © 2010–2024 The Linux Foundation and its Contributors. See the [SPDX 3.0.1 copyright notice](https://spdx.github.io/spdx-spec/v3.0.1/front/copyright/) for the Community Specification License 1.0 and the license for pre-existing portions.
