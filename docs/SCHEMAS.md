---
title: JSON schemas
description: Versioned JSON contracts for Offing's CLI, MCP tools, configuration and exported reports.
---

# JSON schemas

Use the schema shipped with the version of `@velella/offing` that produced your
document. Offing versions these formats separately from the npm package.
See the [compatibility and deprecation policy](STABILITY.md) for how they evolve.
To check the published catalog, use the [standalone conformance runner](spec/schemas/README.md).

## Public contracts

The public schemas cover documented entry points and exported documents.
The configuration and baseline schemas also describe files consumers can supply.
Vendor schemas keep the compatibility policies of their respective standards.

### Agent Guard request

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/agent-guard-request.v1.schema.json)

::schema-table{data="publicSchemas/agent-guard-request" label="Agent Guard request fields"}

### Agent Guard response

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/agent-guard-response.v1.schema.json)

::schema-table{data="publicSchemas/agent-guard-response" label="Agent Guard response fields"}

### Accepted findings baseline

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/baseline.v1.schema.json)

::schema-table{data="publicSchemas/baseline" label="Accepted findings baseline fields"}

### Capability manifest

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/capabilities.v1.schema.json)

::schema-table{data="publicSchemas/capabilities" label="Capability manifest fields"}

### Snippet check

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/check-snippet.v1.schema.json)

::schema-table{data="publicSchemas/check-snippet" label="Snippet check fields"}

### Dependency check

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/check.v1.schema.json)

::schema-table{data="publicSchemas/check" label="Dependency check fields"}

### Configuration validation result

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/config-validation.v1.schema.json)

::schema-table{data="publicSchemas/config-validation" label="Configuration validation result fields"}

### Offing configuration

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/config.v1.schema.json)

::schema-table{data="publicSchemas/config" label="Offing configuration fields"}

### Migration context

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/context.v1.schema.json)

::schema-table{data="publicSchemas/context" label="Migration context fields"}

### Lifecycle data status

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/data-status.v1.schema.json)

::schema-table{data="publicSchemas/data-status" label="Lifecycle data status fields"}

### Deprecation list

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/deprecations.v1.schema.json)

::schema-table{data="publicSchemas/deprecations" label="Deprecation list fields"}

### Doctor report

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/doctor.v1.schema.json)

::schema-table{data="publicSchemas/doctor" label="Doctor report fields"}

### Runtime drift report

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/drift.v1.schema.json)

::schema-table{data="publicSchemas/drift" label="Runtime drift report fields"}

### Lifecycle finding

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/finding.v1.schema.json)

::schema-table{data="publicSchemas/finding" label="Lifecycle finding fields"}

### Fix plan

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/fix.v1.schema.json)

::schema-table{data="publicSchemas/fix" label="Fix plan fields"}

### Lifecycle forecast

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/forecast.v1.schema.json)

::schema-table{data="publicSchemas/forecast" label="Lifecycle forecast fields"}

### Stack inventory

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/inventory.v1.schema.json)

::schema-table{data="publicSchemas/inventory" label="Stack inventory fields"}

### MCP truncated-answer pointer

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/more.v1.schema.json)

::schema-table{data="publicSchemas/more" label="MCP truncated-answer pointer fields"}

### Migration plan

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/plan.v1.schema.json)

::schema-table{data="publicSchemas/plan" label="Migration plan fields"}

### Developer portal export

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/portal.v1.schema.json)

::schema-table{data="publicSchemas/portal" label="Developer portal export fields"}

### Verification receipt

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/receipt.v1.schema.json)

::schema-table{data="publicSchemas/receipt" label="Verification receipt fields"}

### Version recommendation

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/recommend.v1.schema.json)

::schema-table{data="publicSchemas/recommend" label="Version recommendation fields"}

### Repository scan

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/scan.v1.schema.json)

::schema-table{data="publicSchemas/scan" label="Repository scan fields"}

### Upgrade report

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/upgrade.v1.schema.json)

::schema-table{data="publicSchemas/upgrade" label="Upgrade report fields"}

### Migration verification

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/verification.v1.schema.json)

::schema-table{data="publicSchemas/verification" label="Migration verification fields"}

### Verification result

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/verify-result.v1.schema.json)

::schema-table{data="publicSchemas/verify-result" label="Verification result fields"}

### Agent driver run

[Schema source](https://github.com/velella-sh/offing/blob/main/schemas/agent-run.v1.schema.json)

::schema-table{data="publicSchemas/agent-run" label="Agent driver run fields"}

## Internal formats

| Schema | Repository use |
| --- | --- |
| `benchmark-result.v1.schema.json` | Agent proof benchmark reports |
| `migration-review-log.v1.schema.json` | Migration research and ground-truth review |
| `public-validation.v1.schema.json` | Curated public-repository corpus records |
