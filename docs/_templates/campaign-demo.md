---
title: Campaign Board demo
description: Recorded progress from a twenty-repository Node.js migration fixture.
layout: doc
agent:
  source: docs/_templates/campaign-demo.md
---

# Campaign Board demo

This recorded fixture follows a Node.js migration from 18 to a minimum of 22
across GitHub and GitLab test repositories.

**:field[merged] of :field[total] repositories merged.** :field[awaitingReview] are awaiting review.

[Replay the campaign](/CAMPAIGNS/#replay-the-recorded-nodejs-18-to-22-campaign) ·
[Build your own board](/CAMPAIGN_BOARD/) ·
[Inspect the pinned state and proofs](https://github.com/velella-sh/offing/tree/48274e1d97a9fbcbdf1093d83847174a7a751cf1/tests/fixtures/campaign-20)

## Repositories

::record-table{from=campaign-demo-repositories caption="Recorded repository status" columns='[{"field":"name","label":"Repository"},{"field":"batch","label":"Batch","kind":"number"},{"field":"status","label":"Status","kind":"status"}]'}

## Owner progress

::record-table{from=campaign-demo-owners caption="Repository counts by owner" columns='[{"field":"owner","label":"Owner"},{"field":"total","label":"Total","kind":"number"},{"field":"merged","label":"Merged","kind":"number"},{"field":"awaitingReview","label":"In review","kind":"number"}]'}

## Batch activity

::record-table{from=campaign-demo-activity caption="Recorded batch activity" columns='[{"field":"label","label":"Batch"},{"field":"start","label":"Started","kind":"date"},{"field":"status","label":"Status","kind":"status"}]'}
