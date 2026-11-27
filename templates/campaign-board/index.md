---
title: Campaign board
description: Recorded migration campaign progress.
layout: list
list:
  collection: repositories
  columns:
    - { field: repository, label: Repository }
    - { field: batch, label: Batch, kind: number }
    - { field: owners, label: Owners }
    - { field: status, label: Status, kind: status }
    - { field: deadline, label: Deadline, kind: date }
stats: []
---

::stat-strip

<!-- campaign-board-projection -->

## Owner progress

::record-table{from=owners caption="Repository progress by owner" columns='[{"field":"owner","label":"Owner"},{"field":"total","label":"Repositories","kind":"number"},{"field":"merged","label":"Merged","kind":"number"},{"field":"complete","label":"Completed","kind":"number"},{"field":"awaitingReview","label":"Awaiting review","kind":"number"}]'}

<!-- campaign-board-activity -->

<!-- campaign-board-chart -->
