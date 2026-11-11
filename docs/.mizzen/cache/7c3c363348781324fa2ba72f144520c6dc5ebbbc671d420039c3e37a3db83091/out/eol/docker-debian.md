
# Is Debian end of life?

**Some Debian releases are end of life.** Debian image release lines 11 and older are end-of-life as of 2026-08-31. This page lists 1 reviewed lifecycle rule for `pkg:docker/library/debian`, with the status, date, and source for each.

Check a version:

```bash
offing check pkg:docker/library/debian
```

[All product answers](index.html)

| Rule | Status | Date | Affected versions | Sources |
| --- | --- | --- | --- | --- |
| [Debian image release lines 11 and older are end-of-life](../rules/container.debian.eol-11-and-older.html) | End of life | 2026-08-31 | `vers:semver/<12.0.0` | [Debian LTS](https://wiki.debian.org/LTS), [Debian Releases](https://www.debian.org/releases/) |

## Data

This page is generated from the lifecycle registry (`registry/`), not written by hand. Regenerate it with `npm run build:answer-pages`. Each row links to the rule page and the authoritative source for that version.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://velella.sh/offing/eol/docker-debian.html#faq",
  "url": "https://velella.sh/offing/eol/docker-debian.html",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is Debian end of life?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Some Debian releases are end of life. Debian image release lines 11 and older are end-of-life as of 2026-08-31. This page lists 1 reviewed lifecycle rule for pkg:docker/library/debian, with the status, date, and source for each."
      }
    },
    {
      "@type": "Question",
      "name": "How do I check Debian?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Run offing check pkg:docker/library/debian."
      }
    },
    {
      "@type": "Question",
      "name": "Where do the Debian dates come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Each row links to a reviewed Offing rule and the authoritative sources for that version. The page is generated from the lifecycle registry."
      }
    }
  ]
}
</script>
