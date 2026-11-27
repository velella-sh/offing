---
title: Scan an SBOM
description: Check CycloneDX, SPDX and Syft JSON software bills of materials offline.
---

# Scan an SBOM

Use a local SBOM to look for package lifecycle risks with Offing's bundled or
locally installed lifecycle data. Offing reads CycloneDX JSON 1.3–1.7, SPDX 2.3
JSON and Syft's native JSON. It does not fetch the image or run a package manager.
The input limit is 64 MiB.

```sh
offing scan --sbom examples/sbom/image.cdx.json
offing scan --sbom examples/sbom/repository.spdx.json --format sarif
```

Both examples describe `pkg:npm/request@2.88.2`. The image component's BOM
reference is `request-2.88.2`, and the repository package ID is
`SPDXRef-request`. Each produces the `npm.package.request.deprecated`
finding with a source and replacement. The SPDX example also has a package
without a Package URL (PURL), which is listed as skipped.

To scan a container image, install [Syft](https://oss.anchore.com/docs/installation/syft/)
and replace `<image>` with the image name. Syft can also read an existing local
image archive using a source such as `docker-archive:/path/to/image.tar`.

```sh
syft <image> -o cyclonedx-json | offing scan --sbom -
```

Syft supplies the inventory. The Offing stage only reads that inventory and
local lifecycle data. The standard scan reporters and `--fail-on` severity
gate are available. In JSON, `findings[].location.jsonPointer` locates the
component inside the file. Reports label input from stdin as `stdin.sbom.json`.
`unclassified.references` lists the components
skipped because they have no PURL. An SBOM with no findings may still include
packages for which the local data has no rule.

In the [GitHub Action](spec/action/v1.md), set `sbom: path/to/sbom.json` for a
file in the checkout, relative to the Action's `path` input. The Action uses
that SBOM for the usual reports and severity gate. Use scan mode and leave
`paths` empty. In [MCP](MCP.md), call `scan_sbom` with
`{"sbom_path":"path/to/sbom.json"}` and, if needed, `repository_path` to set
the directory from which that path resolves. MCP takes a file because stdin
carries the protocol.

## Coming from xeol

These correspond to the input, reporting and gating options in the
[xeol README](https://github.com/xeol-io/xeol/blob/main/README.md#supported-sources).

| xeol | Offing |
| --- | --- |
| `xeol sbom:./sbom.json` | `offing scan --sbom ./sbom.json` |
| `cat sbom.json \| xeol` | `offing scan --sbom - < sbom.json` |
| `xeol <image>` or `xeol path/to/image.tar` | Generate a JSON SBOM with Syft and pipe it to `offing scan --sbom -`. |
| `-o json` or `-o sarif` | `--format json` or `--format sarif`. Use shell redirection to write a report to a file. |
| `--fail-on-eol-found` | `--fail-on info` exits 1 on any Offing finding, including deprecations. Use `--fail-on high` for a severity threshold. |
| `--lookahead 30d` | `--min-support-days 30` applies Offing's own support-window policy. The flags use different lifecycle data and may report different findings. |
| `--scope all-layers` | Set the layer scope in Syft before scanning. Offing checks the components already present in the SBOM. |
| `att:` sources and `--key` | Offing accepts JSON SBOMs. Verify attestations with your existing tool and pass the extracted JSON to Offing. |
| `xeol db` and `XEOL_DB_AUTO_UPDATE` | The SBOM scan is offline by default. Use `offing data status` to inspect the local data and `offing data update` separately to fetch it. |
