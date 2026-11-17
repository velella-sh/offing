# Forecast coverage gaps

Across 100 snapshots, 45 repositories had at least one reported gap. Twenty had gaps and zero dated findings. Counts below are declaration locations and may count the same component in more than one file or repository.

| Detector | Reason | References |
| --- | --- | ---: |
| npm | Package identity has no lifecycle rule | 1,162 |
| Java | JDK version is a property, expression, or floating value | 13 |
| GitHub Actions | Floating Node selectors (`lts/*`, `lts/gallium`, or `node`) | 8 |
| GitHub Actions | Version is an expression | 2 |
| Container | Image follows the latest release or uses the `latest` tag | 7 |
| Container | Tag is a build argument or variable | 1 |
| CI images | CircleCI orb was not resolved | 3 |
| CI images | Dynamic reference | 1 |
| **Total** | | **1,197** |

Each gap appears in `noData` with its reason and location, outside the dated event groups. The terminal report shows cloudy or storm whenever coverage gaps are present. The reduced CSS.escape fixture verifies that a gap alone produces cloudy weather and points to the exact npm declaration.
