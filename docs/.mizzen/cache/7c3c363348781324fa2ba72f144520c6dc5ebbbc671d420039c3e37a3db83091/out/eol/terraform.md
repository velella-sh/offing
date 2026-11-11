
# Is Terraform end of life?

**Some Terraform releases are end of life.** The list() and map() functions were removed in Terraform 0.15. The source gives no day. This page lists 18 reviewed lifecycle rules for `pkg:generic/terraform`, with the status, date, and source for each.

Check a version:

```bash
offing check pkg:generic/terraform
```

[All product answers](index.html)

| Rule | Status | Date | Affected versions | Sources |
| --- | --- | --- | --- | --- |
| [The list() and map() functions were removed in Terraform 0.15](../rules/terraform.function.list-map.html) | Removed | The source gives no day | `vers:semver/>=0.15.0` | [Terraform 0.15 upgrade guide: legacy configuration language features](https://developer.hashicorp.com/terraform/language/v1.1.x/upgrade-guides/0-15), [Terraform tolist function](https://developer.hashicorp.com/terraform/language/functions/tolist), [Terraform tomap function](https://developer.hashicorp.com/terraform/language/functions/tomap) |
| [Terraform CLI 1.15 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.15.html) | End of support | 2026-10-21 | `vers:semver/>=1.15.0\|<1.16.0` | [hashicorp/terraform release v1.17.0](https://github.com/hashicorp/terraform/releases/tag/v1.17.0), [hashicorp/terraform release v1.15.0](https://github.com/hashicorp/terraform/releases/tag/v1.15.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.14 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.14.html) | End of support | 2026-08-26 | `vers:semver/>=1.14.0\|<1.15.0` | [endoflife.date: Terraform](https://endoflife.date/terraform), [hashicorp/terraform release v1.16.0](https://github.com/hashicorp/terraform/releases/tag/v1.16.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.13 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.13.html) | End of support | 2026-04-29 | `vers:semver/>=1.13.0\|<1.14.0` | [endoflife.date: Terraform](https://endoflife.date/terraform), [hashicorp/terraform release v1.15.0](https://github.com/hashicorp/terraform/releases/tag/v1.15.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.12 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.12.html) | End of support | 2025-11-19 | `vers:semver/>=1.12.0\|<1.13.0` | [endoflife.date: Terraform](https://endoflife.date/terraform), [hashicorp/terraform release v1.14.0](https://github.com/hashicorp/terraform/releases/tag/v1.14.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.11 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.11.html) | End of support | 2025-08-20 | `vers:semver/>=1.11.0\|<1.12.0` | [endoflife.date: Terraform](https://endoflife.date/terraform), [hashicorp/terraform release v1.13.0](https://github.com/hashicorp/terraform/releases/tag/v1.13.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.10 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.10.html) | End of support | 2025-05-14 | `vers:semver/>=1.10.0\|<1.11.0` | [endoflife.date: Terraform](https://endoflife.date/terraform), [hashicorp/terraform release v1.12.0](https://github.com/hashicorp/terraform/releases/tag/v1.12.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113) |
| [Terraform CLI 1.9 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.9.html) | End of support | 2025-02-27 | `vers:semver/>=1.9.0\|<1.10.0` | [hashicorp/terraform release v1.11.0](https://github.com/hashicorp/terraform/releases/tag/v1.11.0), [hashicorp/terraform release v1.9.0](https://github.com/hashicorp/terraform/releases/tag/v1.9.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.8 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.8.html) | End of support | 2024-11-27 | `vers:semver/>=1.8.0\|<1.9.0` | [hashicorp/terraform release v1.10.0](https://github.com/hashicorp/terraform/releases/tag/v1.10.0), [hashicorp/terraform release v1.8.0](https://github.com/hashicorp/terraform/releases/tag/v1.8.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.7 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.7.html) | End of support | 2024-06-26 | `vers:semver/>=1.7.0\|<1.8.0` | [hashicorp/terraform release v1.9.0](https://github.com/hashicorp/terraform/releases/tag/v1.9.0), [hashicorp/terraform release v1.7.0](https://github.com/hashicorp/terraform/releases/tag/v1.7.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.6 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.6.html) | End of support | 2024-04-10 | `vers:semver/>=1.6.0\|<1.7.0` | [hashicorp/terraform release v1.8.0](https://github.com/hashicorp/terraform/releases/tag/v1.8.0), [hashicorp/terraform release v1.6.0](https://github.com/hashicorp/terraform/releases/tag/v1.6.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.5 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.5.html) | End of support | 2024-01-17 | `vers:semver/>=1.5.0\|<1.6.0` | [hashicorp/terraform release v1.7.0](https://github.com/hashicorp/terraform/releases/tag/v1.7.0), [hashicorp/terraform release v1.5.0](https://github.com/hashicorp/terraform/releases/tag/v1.5.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.4 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.4.html) | End of support | 2023-10-04 | `vers:semver/>=1.4.0\|<1.5.0` | [hashicorp/terraform release v1.6.0](https://github.com/hashicorp/terraform/releases/tag/v1.6.0), [hashicorp/terraform release v1.4.0](https://github.com/hashicorp/terraform/releases/tag/v1.4.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.3 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.3.html) | End of support | 2023-06-12 | `vers:semver/>=1.3.0\|<1.4.0` | [hashicorp/terraform release v1.5.0](https://github.com/hashicorp/terraform/releases/tag/v1.5.0), [hashicorp/terraform release v1.3.0](https://github.com/hashicorp/terraform/releases/tag/v1.3.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.2 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.2.html) | End of support | 2023-03-08 | `vers:semver/>=1.2.0\|<1.3.0` | [hashicorp/terraform release v1.4.0](https://github.com/hashicorp/terraform/releases/tag/v1.4.0), [hashicorp/terraform release v1.2.0](https://github.com/hashicorp/terraform/releases/tag/v1.2.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.1 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.1.html) | End of support | 2022-09-21 | `vers:semver/>=1.1.0\|<1.2.0` | [hashicorp/terraform release v1.3.0](https://github.com/hashicorp/terraform/releases/tag/v1.3.0), [hashicorp/terraform release v1.1.0](https://github.com/hashicorp/terraform/releases/tag/v1.1.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Terraform CLI 1.0 is no longer a supported release line](../rules/terraform.cli.end-of-support-1.0.html) | End of support | 2022-05-18 | `vers:semver/>=1.0.0\|<1.1.0` | [hashicorp/terraform release v1.2.0](https://github.com/hashicorp/terraform/releases/tag/v1.2.0), [hashicorp/terraform release v1.0.0](https://github.com/hashicorp/terraform/releases/tag/v1.0.0), [HashiCorp Terraform support policy](https://support.hashicorp.com/hc/en-us/articles/360021185113), [Terraform v1.x compatibility promises](https://developer.hashicorp.com/terraform/language/v1-compatibility-promises), [Terraform upgrade guides](https://developer.hashicorp.com/terraform/language/upgrade-guides) |
| [Interpolation-only strings are deprecated](../rules/terraform.syntax.interpolation-only.html) | Deprecated | The source gives no day | `vers:semver/>=0.12.14` | [hashicorp/terraform release v0.12.14](https://github.com/hashicorp/terraform/releases/tag/v0.12.14), [Terraform 0.15 upgrade guide: legacy configuration language features](https://developer.hashicorp.com/terraform/language/v1.1.x/upgrade-guides/0-15), [Terraform 0.12 upgrade guide: first-class expressions](https://developer.hashicorp.com/terraform/language/v1.1.x/upgrade-guides/0-12) |

## Data

This page is generated from the lifecycle registry (`registry/`), not written by hand. Regenerate it with `npm run build:answer-pages`. Each row links to the rule page and the authoritative source for that version.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://velella.sh/offing/eol/terraform.html#faq",
  "url": "https://velella.sh/offing/eol/terraform.html",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is Terraform end of life?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Some Terraform releases are end of life. The list() and map() functions were removed in Terraform 0.15. The source gives no day. This page lists 18 reviewed lifecycle rules for pkg:generic/terraform, with the status, date, and source for each."
      }
    },
    {
      "@type": "Question",
      "name": "How do I check Terraform?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Run offing check pkg:generic/terraform."
      }
    },
    {
      "@type": "Question",
      "name": "Where do the Terraform dates come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Each row links to a reviewed Offing rule and the authoritative sources for that version. The page is generated from the lifecycle registry."
      }
    }
  ]
}
</script>
