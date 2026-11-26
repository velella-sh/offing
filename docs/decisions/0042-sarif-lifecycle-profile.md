# 0042 — Publish the lifecycle SARIF profile v1

This decision takes effect when the pull request for #537 merges.

Offing exports SARIF 2.1.0 for code scanning. Lifecycle details in rule help
are readable by people. The v1 profile adds structured fields for consumers
that need to filter or compare findings.

Add `properties.offingLifecycle` to rule descriptors and results. Keep the
existing rule IDs, finding fingerprints, severity mapping, help text and
physical locations. Result metadata reflects the finding. Rule metadata uses
the same representative finding as the rule's current default level and help.

Publish the [profile](../spec/sarif/v1.md), its property schema, and a
dependency-free checker. The checker tests the profile's field and
cross-reference requirements. Repository tests also validate against the
official SARIF 2.1.0 schema.
