
# Terraform CLI 1.1 is no longer a supported release line

**End of support** as of 2022-09-21. Replacement: Terraform 1.16 or later. Source: [hashicorp/terraform release v1.3.0](https://github.com/hashicorp/terraform/releases/tag/v1.3.0).

Check a version:

```bash
offing check pkg:generic/terraform
```

HashiCorp supports the two most recent Terraform release lines. Terraform 1.1 (first released 2021-12-08) stopped being one of them when Terraform 1.3 was released on 2022-09-21.

[Look up another package or runtime](../lookup.html) · <form action="../lookup.html" method="get" role="search"><input type="search" name="q" placeholder="Search packages and runtimes" aria-label="Package or runtime" /> <button type="submit">Search</button></form>

| | |
| --- | --- |
| Status | End of support |
| Severity | medium |
| Ecosystem | `terraform` |
| Component | `pkg:generic/terraform` |
| Affected versions | `vers:semver/>=1.1.0\|<1.2.0` |
| Date from the source | 2022-09-21 |
| Replacement | Terraform 1.16 or later |
| Evidence last seen | 2026-11-10 |
| Reviewed | 2026-11-11 by arminazimi, drafted by the `terraform-1` importer |
| Review due | 2027-02-09 (90 days after the last review) |
| Rule ID | `terraform.cli.end-of-support-1.1` |

## Sources

- [hashicorp/terraform release v1.3.0](https://github.com/hashicorp/terraform/releases/tag/v1.3.0) (accessed 2026-11-10)
- [hashicorp/terraform release v1.1.0](https://github.com/hashicorp/terraform/releases/tag/v1.1.0) (accessed 2026-11-10)
- [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) (accessed 2026-11-10)
- [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises) (accessed 2026-11-11)
- [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) (accessed 2026-11-11)

## Migration

**Constraints**

- Keep required_version in *.tf, the pin in .terraform-version or .tool-versions, and the Terraform version installed in CI and by every teammate on one supported release line. A configuration that still pins Terraform 1.1 will refuse to run on a newer CLI if required_version excludes it.
- HashiCorp's v1.x compatibility promises say you should be able to upgrade from any v1.x release to any later v1.x release, but that later releases may introduce state formats earlier versions cannot read, and a downgrade is not guaranteed. Move every place that runs plan or apply together instead of one environment at a time, and back up the state first.
- Read the upgrade guide for each release line you cross; a feature added in a later release does not work on releases that predate it.
- Do not run terraform init -upgrade as part of this change unless provider upgrades are intended: it can change provider versions and rewrite .terraform.lock.hcl.

**Steps**

1. **Back up the Terraform state.** Copy or snapshot the state of every workspace that this configuration manages (for example terraform state pull &gt; backup.tfstate, or a versioned remote backend) before the first run on the new release.
2. **Raise the Terraform CLI pin.** Change the reported .terraform-version or terraform entry in .tool-versions to the release in the replacement.
3. **Raise required_version.** Raise the lower bound of required_version in the terraform block of each *.tf file so it admits only supported releases, and read the upgrade notes of every line you cross.
4. **Align CI and documentation.** Update CI workflows, Docker images, and setup documentation that install Terraform (for example hashicorp/setup-terraform) so they match the new pin.

**Verification**

- `terraform version`: Confirm the active Terraform CLI is the intended release.
- `terraform init -backend=false && terraform validate`: Initialize without touching remote state and check that the configuration is valid on the new release.
- `terraform plan`: Review the plan and confirm the upgrade introduces no unexpected changes.

## Detected by

The `terraform` detector. See [Detectors](../DETECTORS.md) and [Compatibility](../COMPATIBILITY.md).

## Related

### Other versions of this product

- [Terraform CLI 1.0 is no longer a supported release line](terraform.cli.end-of-support-1.0.html)
- [Terraform CLI 1.10 is no longer a supported release line](terraform.cli.end-of-support-1.10.html)
- [Terraform CLI 1.11 is no longer a supported release line](terraform.cli.end-of-support-1.11.html)
- [Terraform CLI 1.12 is no longer a supported release line](terraform.cli.end-of-support-1.12.html)
- [Terraform CLI 1.13 is no longer a supported release line](terraform.cli.end-of-support-1.13.html)
- [Terraform CLI 1.14 is no longer a supported release line](terraform.cli.end-of-support-1.14.html)
- [Terraform CLI 1.15 is no longer a supported release line](terraform.cli.end-of-support-1.15.html)
- [Terraform CLI 1.2 is no longer a supported release line](terraform.cli.end-of-support-1.2.html)
- [Terraform CLI 1.3 is no longer a supported release line](terraform.cli.end-of-support-1.3.html)
- [Terraform CLI 1.4 is no longer a supported release line](terraform.cli.end-of-support-1.4.html)
- [Terraform CLI 1.5 is no longer a supported release line](terraform.cli.end-of-support-1.5.html)
- [Terraform CLI 1.6 is no longer a supported release line](terraform.cli.end-of-support-1.6.html)

### Same ecosystem

- [AKS 1.28 and earlier are no longer supported](terraform.aks.end-of-life-1.28-and-older.html)
- [AKS 1.29 is past long-term support](terraform.aks.end-of-life-1.29.html)
- [AKS 1.30 is past long-term support](terraform.aks.end-of-life-1.30.html)
- [AKS 1.31 is past its 12-month support window](terraform.aks.end-of-support-1.31.html)
- [AKS 1.32 is past its 12-month support window](terraform.aks.end-of-support-1.32.html)
- [AKS 1.33 is past its 12-month support window](terraform.aks.end-of-support-1.33.html)
- [Terraform CLI 1.7 is no longer a supported release line](terraform.cli.end-of-support-1.7.html)
- [Terraform CLI 1.8 is no longer a supported release line](terraform.cli.end-of-support-1.8.html)


## Data

This page is generated from [`registry/terraform.json`](https://github.com/velella-sh/offing/blob/main/registry/terraform.json), rule `terraform.cli.end-of-support-1.1`, in the `ebb.registry.v2` format ([how rules are written](../RULES.md)). A CLE (ECMA-428) export is not published yet. The same facts are embedded in this page as schema.org structured data.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://velella.sh/offing/rules/terraform.cli.end-of-support-1.1.html",
      "url": "https://velella.sh/offing/rules/terraform.cli.end-of-support-1.1.html",
      "mainEntityOfPage": "https://velella.sh/offing/rules/terraform.cli.end-of-support-1.1.html",
      "headline": "Terraform CLI 1.1 is no longer a supported release line — dates, impact, migration",
      "description": "HashiCorp supports the two most recent Terraform release lines. Terraform 1.1 (first released 2021-12-08) stopped being one of them when Terraform 1.3 was released on 2022-09-21.",
      "inLanguage": "en",
      "dateModified": "2026-11-11",
      "keywords": [
        "end-of-support",
        "terraform",
        "medium"
      ],
      "about": {
        "@type": "Thing",
        "name": "Terraform CLI 1.1 is no longer a supported release line",
        "identifier": "pkg:generic/terraform"
      },
      "citation": [
        {
          "@type": "CreativeWork",
          "name": "hashicorp/terraform release v1.3.0",
          "url": "https://github.com/hashicorp/terraform/releases/tag/v1.3.0"
        },
        {
          "@type": "CreativeWork",
          "name": "hashicorp/terraform release v1.1.0",
          "url": "https://github.com/hashicorp/terraform/releases/tag/v1.1.0"
        },
        {
          "@type": "CreativeWork",
          "name": "HashiCorp Terraform support policy",
          "url": "https://support.hashicorp.com/hc/en-us/articles/360021185113"
        },
        {
          "@type": "CreativeWork",
          "name": "Terraform v1.x compatibility promises",
          "url": "https://developer.hashicorp.com/terraform/language/v1-compatibility-promises"
        },
        {
          "@type": "CreativeWork",
          "name": "Terraform upgrade guides",
          "url": "https://developer.hashicorp.com/terraform/language/upgrade-guides"
        }
      ],
      "isBasedOn": "https://github.com/velella-sh/offing/blob/main/registry/terraform.json",
      "publisher": {
        "@type": "Organization",
        "name": "Offing",
        "url": "https://velella.sh/offing"
      }
    },
    {
      "@type": "FAQPage",
      "@id": "https://velella.sh/offing/rules/terraform.cli.end-of-support-1.1.html#faq",
      "url": "https://velella.sh/offing/rules/terraform.cli.end-of-support-1.1.html",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the lifecycle status of pkg:generic/terraform?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "End of support as of 2022-09-21. Affected versions: vers:semver/>=1.1.0|\u003c1.2.0. Source: hashicorp/terraform release v1.3.0 (https://github.com/hashicorp/terraform/releases/tag/v1.3.0)."
          }
        },
        {
          "@type": "Question",
          "name": "What replaces pkg:generic/terraform?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Terraform 1.16 or later"
          }
        },
        {
          "@type": "Question",
          "name": "How do I check pkg:generic/terraform?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Run offing check pkg:generic/terraform."
          }
        }
      ]
    }
  ]
}
</script>
