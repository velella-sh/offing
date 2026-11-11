
# seofleet-cli is deprecated

**Deprecated.** The source gives no day. Replacement: llmscout-cli. Source: [seofleet-cli deprecation notice](https://pypi.org/project/seofleet-cli/).

Check a version:

```bash
offing check pkg:pypi/seofleet-cli
```

The maintainer renamed seofleet-cli to llmscout-cli and states that no further releases will be published under the old name.

[Look up another package or runtime](../lookup.html) · <form action="../lookup.html" method="get" role="search"><input type="search" name="q" placeholder="Search packages and runtimes" aria-label="Package or runtime" /> <button type="submit">Search</button></form>

| | |
| --- | --- |
| Status | Deprecated |
| Severity | medium |
| Ecosystem | `python` |
| Component | `pkg:pypi/seofleet-cli` |
| Affected versions | `vers:pypi/*` |
| Date from the source | The source gives no day |
| Replacement | llmscout-cli |
| Evidence last seen | 2026-10-16 |
| Reviewed | 2026-10-16 by arminazimi |
| Review due | 2027-10-16 (365 days after the last review) |
| Rule ID | `python.package.seofleet-cli.deprecated` |

## Sources

- [seofleet-cli deprecation notice](https://pypi.org/project/seofleet-cli/) (accessed 2026-10-16)

## Migration

**Constraints**

- Preserve scan targets, configured checks, output formats, exit codes, and CI invocation.

**Steps**

1. **Replace seofleet-cli.** Replace the distribution and CLI invocation with llmscout-cli, then migrate configuration using the current project documentation.

**Verification**

- `python -m pytest`: Run CLI integration and repository tests when defined.

## Detected by

The `python` detector. See [Detectors](../DETECTORS.md) and [Compatibility](../COMPATIBILITY.md).

## Related

### Same ecosystem

- [The aifc module was removed in Python 3.13](python.module.aifc.removed.html)
- [The asynchat module was removed in Python 3.12](python.module.asynchat.removed.html)
- [The asyncore module was removed in Python 3.12](python.module.asyncore.removed.html)
- [The audioop module was removed in Python 3.13](python.module.audioop.removed.html)
- [The cgi module was removed in Python 3.13](python.module.cgi.removed.html)
- [The cgitb module was removed in Python 3.13](python.module.cgitb.removed.html)
- [The chunk module was removed in Python 3.13](python.module.chunk.removed.html)
- [The crypt module was removed in Python 3.13](python.module.crypt.removed.html)


## Data

This page is generated from [`registry/python.json`](https://github.com/velella-sh/offing/blob/main/registry/python.json), rule `python.package.seofleet-cli.deprecated`, in the `ebb.registry.v2` format ([how rules are written](../RULES.md)). A CLE (ECMA-428) export is not published yet. The same facts are embedded in this page as schema.org structured data.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://velella.sh/offing/rules/python.package.seofleet-cli.deprecated.html",
      "url": "https://velella.sh/offing/rules/python.package.seofleet-cli.deprecated.html",
      "mainEntityOfPage": "https://velella.sh/offing/rules/python.package.seofleet-cli.deprecated.html",
      "headline": "seofleet-cli is deprecated — dates, impact, migration",
      "description": "The maintainer renamed seofleet-cli to llmscout-cli and states that no further releases will be published under the old name.",
      "inLanguage": "en",
      "dateModified": "2026-10-16",
      "keywords": [
        "deprecated",
        "python",
        "medium"
      ],
      "about": {
        "@type": "Thing",
        "name": "seofleet-cli is deprecated",
        "identifier": "pkg:pypi/seofleet-cli"
      },
      "citation": [
        {
          "@type": "CreativeWork",
          "name": "seofleet-cli deprecation notice",
          "url": "https://pypi.org/project/seofleet-cli/"
        }
      ],
      "isBasedOn": "https://github.com/velella-sh/offing/blob/main/registry/python.json",
      "publisher": {
        "@type": "Organization",
        "name": "Offing",
        "url": "https://velella.sh/offing"
      }
    },
    {
      "@type": "FAQPage",
      "@id": "https://velella.sh/offing/rules/python.package.seofleet-cli.deprecated.html#faq",
      "url": "https://velella.sh/offing/rules/python.package.seofleet-cli.deprecated.html",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the lifecycle status of pkg:pypi/seofleet-cli?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Deprecated. The source gives no day. Affected versions: vers:pypi/*. Source: seofleet-cli deprecation notice (https://pypi.org/project/seofleet-cli/)."
          }
        },
        {
          "@type": "Question",
          "name": "What replaces pkg:pypi/seofleet-cli?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "llmscout-cli"
          }
        },
        {
          "@type": "Question",
          "name": "How do I check pkg:pypi/seofleet-cli?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Run offing check pkg:pypi/seofleet-cli."
          }
        }
      ]
    }
  ]
}
</script>
