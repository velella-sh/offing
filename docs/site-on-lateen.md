---
title: "Site on Mizzen and Lateen"
description: "Capability mapping, preset comparison, family-identity checklist, and recorded upstream dependencies for Offing's documentation site."
---

# Site on Mizzen and Lateen

Offing's documentation site (`docs/`) is built with `@velella/mizzen` (`0.2.7`) and `@velella/lateen` (`0.2.5`). No bespoke HTML, CSS, or JavaScript files live under `docs/` (except the Google Search Console domain verification file).

## Dashboard and lookup capability mapping

| Offing element | Mizzen / Lateen capability | Status / upstream gap |
| --- | --- | --- |
| Dashboard data (`docs/_data/dashboard.json`) | Mizzen `_data` JSON + `collections` (`dashboard`, `dashboard-ecosystems`, `dashboard-minimums`, `dashboard-run`) | Shipped in Mizzen 0.2.7 |
| Corpus per ecosystem chart | Lateen `::bar-chart{from="dashboard.corpus.ecosystems" ...}` | Shipped in Lateen 0.2.5 |
| Detector, ecosystem, minimum, and run tables | Lateen `::record-table{from="..." ...}` | Shipped in Lateen 0.2.5 |
| Missing metrics (`null`) shown as `"not measured"` | Flattened `"not measured"` strings in collection records | Shipped via `tools/build-dashboard-data.ts` |
| Run age and stale badge (`runAgeDays > 14`) from `_data` | Lateen `stale-notice` covers `PageStale` (changed files) only, not `_data` thresholds | **Recorded Lateen dependency**: data-driven run-age / stale-threshold badge component |
| Lifecycle lookup (`/lookup/`) | Mizzen `rules` collection (`docs/_data/rules.json`) + Lateen `::data-explorer{from="rules" filters="ecosystem,event,status" ...}` | Shipped in Mizzen 0.2.7 + Lateen 0.2.5 |
| Rule page search link | Plain link `[Look up another package or runtime](../lookup/)` | Shipped |
| `/lookup.html?q=...` redirect | Mizzen `redirects` (`/lookup.html: /lookup/`) | **Recorded Mizzen dependency**: Mizzen 0.2.7 `redirects.js` writes `location.replace(target)` without `window.location.search`, so `?q=` is not preserved |

## Lateen `offing` preset vs `brand/`

Lateen `0.2.5` ships `tokens/presets/offing.json` with:

- `accent`: light `#6A5590`, dark `#A592CC`
- `neutral`: light (`canvas: #ECEFF4`, `surface: #E5E9F0`, `text: #2E3440`), dark (`canvas: #1F1F28`, `surface: #2A2A37`, `text: #DCD7BA`)

The deleted `docs/assets/css/custom.css` only held legacy Slipway `--sl-color-*` rose/parchment overrides (`#8f3048`, `#f3ece8`, `#262425`) that Lateen does not read. `brand/` provides SVG/PNG marks and favicons referenced by `docs/mizzen.yml`; no extra CSS tokens are required on the Offing side, and any brand-palette alignment is tracked in Lateen `family-identity`.

## `family-identity-3` acceptance check

- **Preset**: `theme.options.preset: offing` in `docs/mizzen.yml`.
- **Footer signature**: `copyright: "© Velella"`, `license: "MIT license"`, and `a Velella project` (`https://velella.sh/`) in `docs/mizzen.yml`.
- **Network navigation**: `network.source: https://velella.sh/network.json` and `network.project: offing` in `docs/mizzen.yml`.
- **Local search**: Mizzen + Lateen Pagefind search (`/search/` and header search dialog) is enabled by default.
