---
title: Export the fleet v1 schema from npm
---

# 0076. Export the fleet v1 schema from npm

Expose `@velella/offing/schemas/fleet.v1.schema.json` as an additive npm
package export. Consumers can import the installed package's JSON Schema
and validate the output of the CLI from that same package version without
network access. The packaged schema uses the same source file and public
schema identifier as the site. The fleet result shape is unchanged.
