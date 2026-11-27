---
title: Campaign board
description: Export and build a campaign board from recorded repository state.
---

# Campaign board

Export a board from a complete [campaign state](spec/campaign/v1.md) into a fresh
directory. The state can also be inspected with `offing campaign status`.

```sh
offing campaign-board state.json --out board
mizzen build board --theme node_modules/@velella/lateen --out board-site
```

Use Node.js 24, Mizzen 0.2.7, and Lateen 0.2.5 for the site build. The exporter
writes Markdown, `mizzen.yml`, the accessible `campaign-progress.svg` badge,
and four JSON collections under `_data/`. The collections contain one row per
repository, one per owner, one summary, and one timeline row per started batch.
The badge shows merged repositories out of the selected total. Check the
export for private repository names, commit IDs and owner names before
publishing it.

A completed repository has reached the terminal `merged` or `cancelled` state.
A repository in `review` contributes to the review count. A repository with
multiple owners contributes once to each owner's totals, and an unowned
repository appears under Unassigned. The source state has repository review
status, so the board lists waiting repositories and counts without linking to
individual pull or merge requests.

A batch completes when every selected repository in it reaches a terminal
state. The projected finish adds the mean time between observed batch
completions once per remaining batch to the latest observed time. The board
shows the number of completed and remaining batches and the evidence timestamp.
It shows an estimate only after at least two batches have distinct completion
times. A board exported from a fresh plan therefore has no projected finish.

## GitHub Pages

Copy `templates/campaign-board/pages.yml` from the installed Offing package to
`.github/workflows/campaign-board.yml` in the operations repository and
configure GitHub Pages to deploy from Actions. Commit a package lock that pins an
Offing build supplying `campaign-board` and the stated site tools. Use
`workflow_dispatch` with a reviewed `state.json` on the default branch. For
automatic rebuilds, have the default-branch campaign job upload a reviewed
`state.json` as the **offing-campaign-state** artifact and call the board
workflow in a dependent job in the same run.

```yaml
  board:
    needs: campaign
    permissions:
      actions: read
      contents: read
      pages: write
      id-token: write
    uses: ./.github/workflows/campaign-board.yml
```

To try the renderer from a repository checkout, copy
`tests/fixtures/campaign-board/synthetic-state.json` to `state.json`. A separate public demo depends on the
[recorded campaign fixture](https://github.com/velella-sh/offing/issues/1019).
The board uses the released Lateen list, status, timeline, stat strip, and
charts. The progress bar and burndown chart are deferred until their components
ship. Follow the [Lateen roadmap](https://github.com/velella-sh/org/blob/main/lateen/ROADMAP.md).
