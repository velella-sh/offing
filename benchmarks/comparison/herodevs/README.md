# HeroDevs public lifecycle dates

This benchmark checks exact upstream end-of-life dates reported on freely readable HeroDevs
public pages. The [method](../../../docs/COMPARISON_METHOD.md#11-common-inventory-comparison-with-xeol-and-herodevs)
fixes the five targeted repositories, the npm package-version unit, and the date outcomes.
[claims.json](claims.json) records the source and checked date. [herodevs.md](herodevs.md) lists
each measured pair. Coverage is limited to the reviewed dated claims.

## Reproduce

The capture retains the distinct versioned npm package URLs by repository and each dated lifecycle
finding from the built Offing CLI. `npm run comparison:reproduce` checks the published results and
their SHA-256 hashes using the committed capture and claims.

To collect a fresh capture, install Syft 0.92.0 from its
[verified release assets](https://github.com/anchore/syft/releases/tag/v0.92.0) and put it on your
PATH. Warm the five exact checkouts identified in [repositories.json](repositories.json) with the
[corpus cache commands](../../../docs/validation/running-the-corpus.md#warm-ahead-run-offline).
Use a clean Offing checkout. The collector reads the five checkouts and bundled lifecycle data.
The capture records the last commit that changed the Offing CLI build inputs.

```bash
export OFFING_CORPUS_CACHE="$HOME/.cache/offing-corpus"
npm run build
node dist/benchmarks/comparison/herodevs/collect.js
npm run comparison:reproduce -- --record
```

Pass an existing directory to the collector to keep the five exact SBOM inputs in a new
subdirectory. For example, `node dist/benchmarks/comparison/herodevs/collect.js /tmp` prints
the path to the retained SBOMs.

Each SBOM is narrowed to npm PURLs with exact semantic versions before Offing runs. The collector
retains a count of non-npm, invalid version, and duplicate artifacts it leaves outside the sample.
In particular, GitHub Actions pinned to a commit SHA do not represent npm release lines. PURLs are
counted once per repository, and pre-release versions fall outside the public stable-major claims.
