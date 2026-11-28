---
title: Offing compared with other tools
---

# Offing compared with other tools

Offing answers one question: **what in this repository is ending, and where is it used?**
Update bots and lifecycle databases answer neighbouring questions. This section states what each
tool is good at, links the evidence for every claim, and says where Offing is the weaker choice.

| Tool | Question it answers | Start with |
| --- | --- | --- |
| Renovate | Which dependencies have newer versions, and can the update be automated? | [Renovate compared](renovate.md) |
| Dependabot | Which dependencies have updates or security advisories on GitHub? | [Dependabot compared](dependabot.md) |
| endoflife.date | When does a product or release line stop receiving support? | [endoflife.date compared](endoflife-date.md) |
| xeol | Which versions in an SBOM does its database mark as end-of-life? | [xeol compared](xeol.md) |
| HeroDevs public dates | Which published upstream end-of-life dates match versions in the sample? | [HeroDevs compared](herodevs.md) |

## Measured results

[Read the method, pins and measured gaps](../COMPARISON.md). Each chart has its own unit and sample.

::bar-chart{from="comparison.renovate" category="label" value="count" title="Renovate comparable pairs in the blind set"}

::bar-chart{from="comparison.dependabot" category="label" value="count" title="Offing findings and declared Dependabot configurations in the blind set"}

::bar-chart{from="comparison.endoflife" category="label" value="count" title="Dated release-line rules compared with endoflife.date"}

::bar-chart{from="comparison.herodevs" category="label" value="count" title="Pinned package-version pairs with a dated HeroDevs claim"}

::bar-chart{from="comparison.historicalXeol" category="label" value="count" title="Historical xeol directory scan product rows"}

Find the [historical xeol directory results and fresh-run status](xeol.md#measured-evidence) on the
xeol page.

## Where Offing differs

- **Evidence, not just a version number.** Every rule names its sources and the date a maintainer
  reviewed it ([RULES.md](../RULES.md)); scans report the data version and age
  ([DATA.md](../DATA.md)).
- **Locations.** Findings point at the exact declaration or usage
  ([ARCHITECTURE.md](../ARCHITECTURE.md)), including retired APIs inside source files, which
  manifest-only tools cannot see.
- **Offline and deterministic.** Scans read local files and bundled data only
  ([DATA.md](../DATA.md)); no account or hosted service is involved.

## Measured, not asserted

Where Offing and Renovate can speak about the same dependency in the same file, the
[differential report](../differential-report.md) compares their results on a pinned corpus and links
the evidence for each disagreement, including the cases Renovate finds and Offing misses. The
method is described in [VALIDATION.md](../VALIDATION.md#differential-testing-against-renovate).
