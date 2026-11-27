---
title: Version the common verification result
---

# 0047. Version the common verification result

Offing exposed a comparison receipt, an MCP verification response and a
text report after local branch fixes. Each reused the same underlying scan
comparison, but callers had to parse the formats separately.

Expose `offing.verify-result.v1` from `receipt --format verify-result`,
`fix --branch --json`, the additive MCP field `verifyResult`, and a bounded
Markdown block. The binary still suggests candidate commands without
running them. Scan identity is optional in `offing.scan.v1`, so older
reports stay readable and unknown identity values remain null. We preserve
`offing.receipt.v1` and `offing.verification.v1` through the deprecation
release.

The verification contract and independent executable checker live in the
[versioned specification](https://velella.sh/offing/spec/verify/v1/). The checker can rebuild
the comparison from the input scans. A consumer that already validates
the previous formats can keep reading them while migrating to the common
document.
