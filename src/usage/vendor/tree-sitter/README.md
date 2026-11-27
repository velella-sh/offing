# Vendored tree-sitter WASM (trimmed)

The runtime and the JavaScript, TypeScript, TSX and Python grammars come from [`@vscode/tree-sitter-wasm@0.3.1`](https://www.npmjs.com/package/@vscode/tree-sitter-wasm) (MIT). Offing vendors the following payloads.

| File | Role |
|---|---|
| `tree-sitter.cjs` | WebAssembly parser runtime (`.cjs` so it stays CommonJS inside this package) |
| `tree-sitter.d.ts` | Typings for that runtime |
| `tree-sitter.wasm.b64` | Runtime WebAssembly module |
| `tree-sitter-javascript.wasm.b64` | JavaScript grammar |
| `tree-sitter-typescript.wasm.b64` | TypeScript grammar |
| `tree-sitter-tsx.wasm.b64` | TSX grammar |
| `tree-sitter-python.wasm.b64` | Python grammar |
| `tree-sitter-go.wasm.b64` | Go grammar |
| `tree-sitter-java.wasm.b64` | Java grammar |
| `tree-sitter-csharp.wasm.b64` | C# grammar |
| `LICENSE-go`, `LICENSE-java`, `LICENSE-csharp` | Licenses at the pinned grammar revisions |
| `manifest.json` | Upstream releases, decoded SHA-256, sizes and grammar license hashes |

The additional grammars come from the official pinned releases.
[Go v0.25.0](https://github.com/tree-sitter/tree-sitter-go/releases/tag/v0.25.0) ·
[Java v0.23.5](https://github.com/tree-sitter/tree-sitter-java/releases/tag/v0.23.5) ·
[C# v0.24.0](https://github.com/tree-sitter/tree-sitter-c-sharp/releases/tag/v0.24.0)

## Why the payloads are text

The WebAssembly modules are stored as Brotli-compressed base64 text to fit
the npm tarball budget and the repository's text artifact checks.
`src/usage/tree-sitter.ts` decodes the runtime and requested grammar in
memory. Each grammar loads independently when first requested.

`manifest.json` is the record of where each payload came from:

- package: `@vscode/tree-sitter-wasm@0.3.1`, MIT
- tarball: the `source` field in `manifest.json`
- one `sha256` and byte count per decoded payload, plus its upstream path

## Refresh

Install the pinned runtime in the development checkout. Stage each
grammar's official WebAssembly asset under the `upstream` filename
in `manifest.json`. Stage each license from the recorded commit under
its `licenseFile` name. The sync checks those input digests before
encoding the payloads.

```bash
npm install --no-save --package-lock=false --ignore-scripts @vscode/tree-sitter-wasm@0.3.1
npm run build
node dist/tools/sync-tree-sitter-wasm.js /path/to/pinned-release-assets
node dist/tools/verify-tree-sitter-wasm.js
```

The offline verifier checks the decoded sizes and SHA-256 digests,
the separately pinned licenses, and the expected text payloads. To update
a source, change its pin in `tools/sync-tree-sitter-wasm.ts` and review
the regenerated manifest.

## Local patch to the runtime

`tree-sitter.cjs` is copied from upstream except for one line: `addEmJs` strips every `*` from
an EM_JS parameter type instead of only the first, so a `char **` argument produces a valid
helper. `tools/sync-tree-sitter-wasm.ts` applies that patch while syncing and fails if the
upstream line it replaces moves, so a refresh cannot silently drop it.
