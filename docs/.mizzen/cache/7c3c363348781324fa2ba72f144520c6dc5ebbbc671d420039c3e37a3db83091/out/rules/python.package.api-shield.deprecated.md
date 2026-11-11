
# api-shield is deprecated

**Deprecated.** The source gives no day. Replacement: waygate. Source: [api-shield deprecation notice](https://pypi.org/project/api-shield/).

Check a version:

```bash
offing check pkg:pypi/api-shield
```

The maintainer renamed api-shield to waygate and states that no further releases will be published under the old name.

[Look up another package or runtime](../lookup.html) · <form action="../lookup.html" method="get" role="search"><input type="search" name="q" placeholder="Search packages and runtimes" aria-label="Package or runtime" /> <button type="submit">Search</button></form>

| | |
| --- | --- |
| Status | Deprecated |
| Severity | medium |
| Ecosystem | `python` |
| Component | `pkg:pypi/api-shield` |
| Affected versions | `vers:pypi/*` |
| Date from the source | The source gives no day |
| Replacement | waygate |
| Evidence last seen | 2026-10-16 |
| Reviewed | 2026-10-16 by arminazimi |
| Review due | 2027-10-16 (365 days after the last review) |
| Rule ID | `python.package.api-shield.deprecated` |

## Sources

- [api-shield deprecation notice](https://pypi.org/project/api-shield/) (accessed 2026-10-16)

## Migration

**Constraints**

- Preserve feature flags, rollout state, rate limits, maintenance windows, storage, and framework adapters.

**Steps**

1. **Replace api-shield.** Replace the distribution, change shield imports and commands to waygate, and migrate configuration using the maintained documentation.

**Verification**

- `python -m pytest`: Run policy, rollout, rate-limit, and repository tests.

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

This page is generated from [`registry/python.json`](https://github.com/velella-sh/offing/blob/main/registry/python.json), rule `python.package.api-shield.deprecated`, in the `ebb.registry.v2` format ([how rules are written](../RULES.md)). A CLE (ECMA-428) export is not published yet. The same facts are embedded in this page as schema.org structured data.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://velella.sh/offing/rules/python.package.api-shield.deprecated.html",
      "url": "https://velella.sh/offing/rules/python.package.api-shield.deprecated.html",
      "mainEntityOfPage": "https://velella.sh/offing/rules/python.package.api-shield.deprecated.html",
      "headline": "api-shield is deprecated — dates, impact, migration",
      "description": "The maintainer renamed api-shield to waygate and states that no further releases will be published under the old name.",
      "inLanguage": "en",
      "dateModified": "2026-10-16",
      "keywords": [
        "deprecated",
        "python",
        "medium"
      ],
      "about": {
        "@type": "Thing",
        "name": "api-shield is deprecated",
        "identifier": "pkg:pypi/api-shield"
      },
      "citation": [
        {
          "@type": "CreativeWork",
          "name": "api-shield deprecation notice",
          "url": "https://pypi.org/project/api-shield/"
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
      "@id": "https://velella.sh/offing/rules/python.package.api-shield.deprecated.html#faq",
      "url": "https://velella.sh/offing/rules/python.package.api-shield.deprecated.html",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the lifecycle status of pkg:pypi/api-shield?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Deprecated. The source gives no day. Affected versions: vers:pypi/*. Source: api-shield deprecation notice (https://pypi.org/project/api-shield/)."
          }
        },
        {
          "@type": "Question",
          "name": "What replaces pkg:pypi/api-shield?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "waygate"
          }
        },
        {
          "@type": "Question",
          "name": "How do I check pkg:pypi/api-shield?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Run offing check pkg:pypi/api-shield."
          }
        }
      ]
    }
  ]
}
</script>
