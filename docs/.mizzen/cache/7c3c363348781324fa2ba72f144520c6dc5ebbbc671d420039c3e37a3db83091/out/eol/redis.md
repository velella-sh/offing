
# Is Redis end of life?

**Some Redis releases are end of life.** Redis 7.0 is end-of-life as of 2024-07-29. This page lists 3 reviewed lifecycle rules for `pkg:generic/redis`, with the status, date, and source for each.

Check a version:

```bash
offing check pkg:generic/redis
```

[All product answers](index.html)

| Rule | Status | Date | Affected versions | Sources |
| --- | --- | --- | --- | --- |
| [Redis 7.0 is end-of-life](../rules/database.redis.end-of-life-7.0.html) | End of life | 2024-07-29 | `vers:semver/>=7.0.0\|<7.1.0` | [Redis Open Source version management](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/), [endoflife.date: Redis](https://endoflife.date/redis) |
| [Redis 6.0 is end-of-life](../rules/database.redis.end-of-life-6.0.html) | End of life | 2022-05-31 | `vers:semver/>=6.0.0\|<6.1.0` | [Redis support policy (vendor)](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/), [endoflife.date (index; the vendor page above is the evidence)](https://endoflife.date/redis), [Redis 7.0 release notes](https://raw.githubusercontent.com/redis/redis/7.0/00-RELEASENOTES) |
| [Redis 5.0 is end-of-life](../rules/database.redis.end-of-life-5.0.html) | End of life | 2022-04-27 | `vers:semver/>=5.0.0\|<5.1.0` | [Redis support policy (vendor)](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/), [endoflife.date (index; the vendor page above is the evidence)](https://endoflife.date/redis), [Redis 7.0 release notes](https://raw.githubusercontent.com/redis/redis/7.0/00-RELEASENOTES) |

## Data

This page is generated from the lifecycle registry (`registry/`), not written by hand. Regenerate it with `npm run build:answer-pages`. Each row links to the rule page and the authoritative source for that version.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://velella.sh/offing/eol/redis.html#faq",
  "url": "https://velella.sh/offing/eol/redis.html",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is Redis end of life?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Some Redis releases are end of life. Redis 7.0 is end-of-life as of 2024-07-29. This page lists 3 reviewed lifecycle rules for pkg:generic/redis, with the status, date, and source for each."
      }
    },
    {
      "@type": "Question",
      "name": "How do I check Redis?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Run offing check pkg:generic/redis."
      }
    },
    {
      "@type": "Question",
      "name": "Where do the Redis dates come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Each row links to a reviewed Offing rule and the authoritative sources for that version. The page is generated from the lifecycle registry."
      }
    }
  ]
}
</script>
