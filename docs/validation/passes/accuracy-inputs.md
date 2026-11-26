---
title: Version files for the accuracy dashboard
---

# Version files for the accuracy dashboard

The dashboard corpus covers these four targeted repositories. The linked files are pinned to the same commits as the corpus entries.

| Repository | Reviewed declaration |
| --- | --- |
| jdx/mise | [`mise.toml` pins Node 24](https://github.com/jdx/mise/blob/f70c2d93e5baf4480af0286fa44a1e30ac3322a6/mise.toml#L35). No bundled lifecycle rule applies to that declaration. |
| pure-css/pure | [`package.json` declares Node 26 or newer in `devEngines`](https://github.com/pure-css/pure/blob/321da651ef93df92492569551f53f17f3ba88baa/package.json). The declaration does not match a bundled lifecycle rule. |
| pandas-dev/pandas | [`environment.yml` pins Python 3.8](https://github.com/pandas-dev/pandas/blob/2e218d10984e9919f0296931d92ea851c6a6faf5/environment.yml#L6). The [Python release status](https://devguide.python.org/versions/) identifies the unsupported release line. |
| android/nowinandroid | [The Gradle version catalog declares AGP 9.3.2](https://github.com/android/nowinandroid/blob/2982e63cb691ad49cd009aab43dc206fee6699c2/gradle/libs.versions.toml#L5). Ebb 0.2.0 has no lifecycle rule for that version. |

For findings elsewhere in these repositories, the corpus entries record the literal declarations, file locations, and lifecycle sources. Recheck the four pins with the offline corpus harness after warming the selected checkouts.

```sh
npm run validate:public-repos -- --offline --repo jdx/mise --repo pure-css/pure --repo pandas-dev/pandas --repo android/nowinandroid
```
