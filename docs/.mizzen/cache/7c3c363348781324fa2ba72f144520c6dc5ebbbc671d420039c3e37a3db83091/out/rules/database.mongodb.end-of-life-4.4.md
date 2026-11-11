
# MongoDB Server 4.4 is end-of-life

**End of life** as of 2024-02-29. Source: [MongoDB Server support policy (vendor)](https://www.mongodb.com/legal/support-policy).

Check a version:

```bash
offing check pkg:generic/mongodb
```

MongoDB Server 4.4 reached end of life on 2024-02-29 and no longer receives fixes from the vendor.

[Look up another package or runtime](../lookup.html) · <form action="../lookup.html" method="get" role="search"><input type="search" name="q" placeholder="Search packages and runtimes" aria-label="Package or runtime" /> <button type="submit">Search</button></form>

| | |
| --- | --- |
| Status | End of life |
| Severity | high |
| Ecosystem | `database` |
| Component | `pkg:generic/mongodb` |
| Affected versions | `vers:semver/>=4.4.0\|<4.5.0` |
| Date from the source | 2024-02-29 |
| Evidence last seen | 2026-11-10 |
| Reviewed | 2026-11-11 by arminazimi, drafted by the `database-2` importer |
| Review due | 2027-02-09 (90 days after the last review) |
| Rule ID | `database.mongodb.end-of-life-4.4` |

## Sources

- [MongoDB Server support policy (vendor)](https://www.mongodb.com/legal/support-policy) (accessed 2026-11-10)
- [endoflife.date (index; the vendor page above is the evidence)](https://endoflife.date/mongodb) (accessed 2026-11-10)
- [MongoDB Versions and Upgrade Paths](https://www.mongodb.com/docs/mongodb-versions/) (accessed 2026-11-11)
- [Upgrade a Replica Set to MongoDB 8.0](https://www.mongodb.com/docs/manual/release-notes/8.0-upgrade-replica-set/) (accessed 2026-11-11)

## Migration

**Constraints**

- MongoDB documents that a deployment must upgrade through each major release in turn; it does not support jumping straight to a distant major. The 8.0 upgrade guide states that to upgrade from a version earlier than 7.0 you must successively upgrade major releases until you reach 7.0, and only then move to 8.0.
- Upgrading the binaries and raising featureCompatibilityVersion are two separate steps for each release. While FCV stays at the old value a self-managed deployment can still downgrade; raising it enables features that write data older versions cannot read.
- Each release has its own upgrade page with standalone, replica set, and sharded cluster procedures, and its own compatibility changes. Read the page for every release you cross, and confirm your drivers support the target version before you start.
- Changing a Compose image tag restarts the container but does not migrate data: point the new version at the existing volume only after a backup exists.

**Steps**

1. **Back up the data first.** Take a verified backup of every MongoDB deployment in the reported files before changing any version, and keep it until the new version serves traffic without errors.
2. **Upgrade the MongoDB deployment.** Follow the vendor upgrade procedure for your topology, one release at a time: replace the binaries (secondaries first, then step down the primary and upgrade it), then raise featureCompatibilityVersion once the release has run correctly. Test in a non-production deployment first.
3. **Raise the declared version.** Change the image tag in every Compose file that runs MongoDB, including overrides, to the release you upgraded to. Do this in every file and environment, not only the reported line.
4. **Check clients and tooling.** Update drivers, ODMs, CI service containers, and local setup documentation that assume the old MongoDB version.

**Verification**

- `docker compose config`: Confirm the Compose file is valid and shows the intended MongoDB image tag after the change.
- `mongosh --quiet --eval "db.version()"`: Confirm the running server reports the intended MongoDB version.
- `mongosh --quiet --eval "db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 })"`: Confirm featureCompatibilityVersion matches the upgrade step you have completed.
- `terraform plan`: Review the plan and confirm no Terraform-managed resource still declares the retired version line, and that any version change is intended.

## Detected by

The `database` detector. See [Detectors](../DETECTORS.md) and [Compatibility](../COMPATIBILITY.md).

## Related

### Other versions of this product

- [MongoDB Server 4.0 is end-of-life](database.mongodb.end-of-life-4.0.html)
- [MongoDB Server 4.2 is end-of-life](database.mongodb.end-of-life-4.2.html)
- [MongoDB Server 5.0 is end-of-life](database.mongodb.end-of-life-5.0.html)
- [MongoDB Server 5.1 is end-of-life](database.mongodb.end-of-life-5.1.html)
- [MongoDB Server 5.2 is end-of-life](database.mongodb.end-of-life-5.2.html)
- [MongoDB Server 5.3 is end-of-life](database.mongodb.end-of-life-5.3.html)
- [MongoDB Server 6.0 is end-of-life](database.mongodb.end-of-life-6.0.html)
- [MongoDB Server 6.1 is end-of-life](database.mongodb.end-of-life-6.1.html)
- [MongoDB Server 6.2 is end-of-life](database.mongodb.end-of-life-6.2.html)
- [MongoDB Server 6.3 is end-of-life](database.mongodb.end-of-life-6.3.html)
- [MongoDB Server 7.1 is end-of-life](database.mongodb.end-of-life-7.1.html)
- [MongoDB Server 7.2 is end-of-life](database.mongodb.end-of-life-7.2.html)

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

This page is generated from [`registry/database.json`](https://github.com/velella-sh/offing/blob/main/registry/database.json), rule `database.mongodb.end-of-life-4.4`, in the `ebb.registry.v2` format ([how rules are written](../RULES.md)). A CLE (ECMA-428) export is not published yet. The same facts are embedded in this page as schema.org structured data.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://velella.sh/offing/rules/database.mongodb.end-of-life-4.4.html",
      "url": "https://velella.sh/offing/rules/database.mongodb.end-of-life-4.4.html",
      "mainEntityOfPage": "https://velella.sh/offing/rules/database.mongodb.end-of-life-4.4.html",
      "headline": "MongoDB Server 4.4 is end-of-life — dates, impact, migration",
      "description": "MongoDB Server 4.4 reached end of life on 2024-02-29 and no longer receives fixes from the vendor.",
      "inLanguage": "en",
      "dateModified": "2026-11-11",
      "keywords": [
        "end-of-life",
        "database",
        "high"
      ],
      "about": {
        "@type": "Thing",
        "name": "MongoDB Server 4.4 is end-of-life",
        "identifier": "pkg:generic/mongodb"
      },
      "citation": [
        {
          "@type": "CreativeWork",
          "name": "MongoDB Server support policy (vendor)",
          "url": "https://www.mongodb.com/legal/support-policy"
        },
        {
          "@type": "CreativeWork",
          "name": "endoflife.date (index; the vendor page above is the evidence)",
          "url": "https://endoflife.date/mongodb"
        },
        {
          "@type": "CreativeWork",
          "name": "MongoDB Versions and Upgrade Paths",
          "url": "https://www.mongodb.com/docs/mongodb-versions/"
        },
        {
          "@type": "CreativeWork",
          "name": "Upgrade a Replica Set to MongoDB 8.0",
          "url": "https://www.mongodb.com/docs/manual/release-notes/8.0-upgrade-replica-set/"
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
      "@id": "https://velella.sh/offing/rules/database.mongodb.end-of-life-4.4.html#faq",
      "url": "https://velella.sh/offing/rules/database.mongodb.end-of-life-4.4.html",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the lifecycle status of pkg:generic/mongodb?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "End of life as of 2024-02-29. Affected versions: vers:semver/>=4.4.0|\u003c4.5.0. Source: MongoDB Server support policy (vendor) (https://www.mongodb.com/legal/support-policy)."
          }
        },
        {
          "@type": "Question",
          "name": "How do I check pkg:generic/mongodb?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Run offing check pkg:generic/mongodb."
          }
        }
      ]
    }
  ]
}
</script>
