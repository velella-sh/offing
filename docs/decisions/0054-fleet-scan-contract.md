---
title: Version the fleet scan result
---

# 0054. Version the fleet scan result

Fleet scanning discovers authorized repositories and pins each default branch
before reading detector inputs. The scanner runs on materialized files after
the network transport has finished and Git metadata has been removed.

`offing.fleet.v1` keeps the rollup aggregates and includes a
`repositoryStatus` row for each discovered repository. Each row records its
host, name, default branch, commit and scan status. An unavailable branch or
commit is null, and skipped or failed repositories carry a reason. A fleet
document contains aggregate lifecycle data, with no file contents or
credentials. Cache entries use the host, repository, commit, detector
patterns, active data version and scan day.

The existing `offing.rollup.v1` output remains available when combining local
scan reports. Passing fleet documents to `offing rollup` preserves their
per-repository statuses and the aggregate report format.
