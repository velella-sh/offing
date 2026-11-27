---
title: Upgrade blocker graph
---

# 0048. Upgrade blocker graph

**Status:** accepted

`offing.upgrade.v1` adds an optional `chain` to an issue when the
lockfile and direct declarations establish a path from a direct dependency
to the package that produced the issue. The chain uses locked package and
version identities. For repeated names, follow the resolved installation or
use an unambiguous locked version. Keep the chain absent when a lock format
or fixture does not establish a path.

The report adds an optional `graph`. It groups confirmed blockers by the
first dependency in their shortest chain, ranks groups by blocker count,
and keeps unresolved paths under `ungrouped`. The graph omits source line
numbers so cosmetic lockfile reordering does not alter the rendered graph.
The underlying issues retain their exact source locations. A graph entry's
`firstSupported` is `unknown` without published evidence for the first
package release that supports the runtime target.

`check_upgrade` supplies the graph. The CLI supplies it with `--graph` and
uses the same data for the tree, Mermaid and SVG outputs. Both surfaces
preserve the verdict, issues, source locations and exit status.
