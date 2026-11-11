
# Redis 6.0 is end-of-life

**End of life** as of 2022-05-31. Source: [Redis support policy (vendor)](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/).

Check a version:

```bash
offing check pkg:generic/redis
```

Redis 6.0 reached end of life on 2022-05-31 and no longer receives fixes from the vendor.

[Look up another package or runtime](../lookup.html) · <form action="../lookup.html" method="get" role="search"><input type="search" name="q" placeholder="Search packages and runtimes" aria-label="Package or runtime" /> <button type="submit">Search</button></form>

| | |
| --- | --- |
| Status | End of life |
| Severity | high |
| Ecosystem | `database` |
| Component | `pkg:generic/redis` |
| Affected versions | `vers:semver/>=6.0.0\|<6.1.0` |
| Date from the source | 2022-05-31 |
| Evidence last seen | 2026-11-10 |
| Reviewed | 2026-11-11 by arminazimi, drafted by the `database-2` importer |
| Review due | 2027-02-09 (90 days after the last review) |
| Rule ID | `database.redis.end-of-life-6.0` |

## Sources

- [Redis support policy (vendor)](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/) (accessed 2026-11-10)
- [endoflife.date (index; the vendor page above is the evidence)](https://endoflife.date/redis) (accessed 2026-11-10)
- [Redis 7.0 release notes](https://raw.githubusercontent.com/redis/redis/7.0/00-RELEASENOTES) (accessed 2026-11-11)

## Migration

**Constraints**

- Redis persists data in RDB snapshots and the AOF log; a dataset written by a newer server cannot be read by an older one, so a backup taken before the upgrade is the only way back.
- Redis 7.0 and later use RDB format version 10, which older versions cannot read, and store the AOF as multiple files in a directory. When the target is 7.0 or later, plan for both changes.
- The Redis documentation reviewed does not publish a supported path for jumping from 6.0 to a distant release. Read the release notes of every major line you cross and rehearse the upgrade on a copy of the data first.
- Changing a Compose image tag restarts the container but does not migrate data: point the new version at the existing volume, or restore the backup into a fresh one.
- Managed Redis services such as ElastiCache and Memorystore name their own engine version and are not matched by this rule; check their support policy separately.

**Steps**

1. **Back up the data first.** Take a verified RDB snapshot (BGSAVE) or copy the AOF and its directory for every Redis instance in the reported files before changing any version. Keep the backup until the new version serves traffic without errors.
2. **Upgrade the Redis server.** Start a supported Redis version against a copy of the data on a staging instance, or as a replica of the current server, and check the log and INFO for load errors before switching traffic. On Compose, change the image tag and confirm the container starts with the same volume.
3. **Raise the declared version.** Change the image tag in every Compose file that runs Redis, including overrides, to a supported release listed on the Redis Open Source version management page. Do this in every environment, not only the reported line.
4. **Check clients and tooling.** Update Redis client libraries, ACL users that depend on changed commands, and CI service containers or local setup documentation that assume the old Redis version.

**Verification**

- `docker compose config`: Confirm the Compose file is valid and shows the intended Redis image tag after the change.
- `redis-cli INFO server`: Confirm redis_version on the running server reports the target release.
- `terraform plan`: Review the plan and confirm no Terraform-managed resource still declares the retired version line, and that any version change is intended.

## Detected by

The `database` detector. See [Detectors](../DETECTORS.md) and [Compatibility](../COMPATIBILITY.md).

## Related

### Other versions of this product

- [Redis 5.0 is end-of-life](database.redis.end-of-life-5.0.html)
- [Redis 7.0 is end-of-life](database.redis.end-of-life-7.0.html)

### Same ecosystem

- [Aurora MySQL version 1 is past end of standard support](database.aws-aurora-mysql.end-of-support-5.6.html)
- [Aurora MySQL version 2 is past end of standard support](database.aws-aurora-mysql.end-of-support-5.7.html)
- [Aurora PostgreSQL 11 is past end of standard support](database.aws-aurora-postgresql.end-of-support-11.html)
- [Aurora PostgreSQL 12 is past end of standard support](database.aws-aurora-postgresql.end-of-support-12.html)
- [Aurora PostgreSQL 13 is past end of standard support](database.aws-aurora-postgresql.end-of-support-13.html)
- [Aurora PostgreSQL 14 reaches end of standard support on 2027-02-28](database.aws-aurora-postgresql.scheduled-end-of-support-14.html)
- [ElastiCache for Redis OSS 4 is past end of standard support](database.aws-elasticache-redis.end-of-support-4.html)
- [ElastiCache for Redis OSS 5 is past end of standard support](database.aws-elasticache-redis.end-of-support-5.html)


## Data

This page is generated from [`registry/database.json`](https://github.com/velella-sh/offing/blob/main/registry/database.json), rule `database.redis.end-of-life-6.0`, in the `ebb.registry.v2` format ([how rules are written](../RULES.md)). A CLE (ECMA-428) export is not published yet. The same facts are embedded in this page as schema.org structured data.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://velella.sh/offing/rules/database.redis.end-of-life-6.0.html",
      "url": "https://velella.sh/offing/rules/database.redis.end-of-life-6.0.html",
      "mainEntityOfPage": "https://velella.sh/offing/rules/database.redis.end-of-life-6.0.html",
      "headline": "Redis 6.0 is end-of-life — dates, impact, migration",
      "description": "Redis 6.0 reached end of life on 2022-05-31 and no longer receives fixes from the vendor.",
      "inLanguage": "en",
      "dateModified": "2026-11-11",
      "keywords": [
        "end-of-life",
        "database",
        "high"
      ],
      "about": {
        "@type": "Thing",
        "name": "Redis 6.0 is end-of-life",
        "identifier": "pkg:generic/redis"
      },
      "citation": [
        {
          "@type": "CreativeWork",
          "name": "Redis support policy (vendor)",
          "url": "https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/"
        },
        {
          "@type": "CreativeWork",
          "name": "endoflife.date (index; the vendor page above is the evidence)",
          "url": "https://endoflife.date/redis"
        },
        {
          "@type": "CreativeWork",
          "name": "Redis 7.0 release notes",
          "url": "https://raw.githubusercontent.com/redis/redis/7.0/00-RELEASENOTES"
        }
      ],
      "isBasedOn": "https://github.com/velella-sh/offing/blob/main/registry/database.json",
      "publisher": {
        "@type": "Organization",
        "name": "Offing",
        "url": "https://velella.sh/offing"
      }
    },
    {
      "@type": "FAQPage",
      "@id": "https://velella.sh/offing/rules/database.redis.end-of-life-6.0.html#faq",
      "url": "https://velella.sh/offing/rules/database.redis.end-of-life-6.0.html",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the lifecycle status of pkg:generic/redis?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "End of life as of 2022-05-31. Affected versions: vers:semver/>=6.0.0|\u003c6.1.0. Source: Redis support policy (vendor) (https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/)."
          }
        },
        {
          "@type": "Question",
          "name": "How do I check pkg:generic/redis?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Run offing check pkg:generic/redis."
          }
        }
      ]
    }
  ]
}
</script>
