
# Is PowerShell end of life?

**Some PowerShell releases are end of life.** PowerShell 7.4 (LTS) is no longer supported as of 2026-11-10. This page lists 7 reviewed lifecycle rules for `pkg:generic/powershell`, with the status, date, and source for each.

Check a version:

```bash
offing check pkg:generic/powershell
```

[All product answers](index.html)

| Rule | Status | Date | Affected versions | Sources |
| --- | --- | --- | --- | --- |
| [PowerShell 7.4 (LTS) is no longer supported](../rules/shell.powershell.end-of-life-7.4.html) | End of life | 2026-11-10 | `vers:semver/>=7.4.0\|<7.5.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 7.5 is no longer supported](../rules/shell.powershell.end-of-life-7.5.html) | End of life | 2026-11-10 | `vers:semver/>=7.5.0\|<7.6.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 7.2 (LTS) is no longer supported](../rules/shell.powershell.end-of-life-7.2.html) | End of life | 2024-11-08 | `vers:semver/>=7.2.0\|<7.3.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 7.3 is no longer supported](../rules/shell.powershell.end-of-life-7.3.html) | End of life | 2024-05-08 | `vers:semver/>=7.3.0\|<7.4.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 7.0 (LTS) is no longer supported](../rules/shell.powershell.end-of-life-7.0.html) | End of life | 2022-12-03 | `vers:semver/>=7.0.0\|<7.1.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 7.1 is no longer supported](../rules/shell.powershell.end-of-life-7.1.html) | End of life | 2022-05-08 | `vers:semver/>=7.1.0\|<7.2.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |
| [PowerShell 6.x is no longer supported](../rules/shell.powershell.end-of-life-6.html) | End of life | 2020-09-04 | `vers:semver/>=6.0.0\|<7.0.0` | [PowerShell support lifecycle](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle) |

## Data

This page is generated from the lifecycle registry (`registry/`), not written by hand. Regenerate it with `npm run build:answer-pages`. Each row links to the rule page and the authoritative source for that version.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://velella.sh/offing/eol/powershell.html#faq",
  "url": "https://velella.sh/offing/eol/powershell.html",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is PowerShell end of life?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Some PowerShell releases are end of life. PowerShell 7.4 (LTS) is no longer supported as of 2026-11-10. This page lists 7 reviewed lifecycle rules for pkg:generic/powershell, with the status, date, and source for each."
      }
    },
    {
      "@type": "Question",
      "name": "How do I check PowerShell?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Run offing check pkg:generic/powershell."
      }
    },
    {
      "@type": "Question",
      "name": "Where do the PowerShell dates come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Each row links to a reviewed Offing rule and the authoritative sources for that version. The page is generated from the lifecycle registry."
      }
    }
  ]
}
</script>
