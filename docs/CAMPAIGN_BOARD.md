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
`workflow_dispatch` with a reviewed `state.json` on the default branch.

For automatic rebuilds, upload the reviewed `state.json` as the
`offing-campaign-state` artifact after each campaign run. Call the board
workflow in a dependent job in that same run. Keep publishing the reviewed
state if a completed run records failed repositories. Set the producer job's
`board_state_ready` output to `true` only after the state artifact has uploaded.

```yaml
  board:
    needs: campaign
    if: ${{ !cancelled() && needs.campaign.outputs.board_state_ready == 'true' }}
    permissions:
      actions: read
      contents: read
      pages: write
      id-token: write
    uses: ./.github/workflows/campaign-board.yml
```

The called workflow builds from the artifact on the default branch and
queues Pages deployments. The build job reads repository contents and
artifacts. The deploy job has the Pages write and ID-token permissions.
[GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

## Recorded demo

The [Campaign Board demo](https://velella.sh/offing/campaigns/demo/) displays the recorded migration
from Node.js 18 to a minimum of 22 across 20 fixture repositories. The
[recorded ledger and proofs](https://github.com/velella-sh/offing/tree/48274e1d97a9fbcbdf1093d83847174a7a751cf1/tests/fixtures/campaign-20)
include the final recorded Git refs.

From an Offing checkout, run these commands with a build that supplies
`campaign-board` and a new output directory.

```sh
offing campaign status tests/fixtures/campaign-20/state.json
offing campaign-board tests/fixtures/campaign-20/state.json --out demo-board
mizzen build demo-board --theme node_modules/@velella/lateen --out demo-board-site
```

The demo uses Lateen's record tables and status labels. The standalone
export also uses Lateen's list, stat strip, timeline and charts. The
progress bar and burndown chart remain deferred until their components
ship. Follow the [Lateen roadmap](https://github.com/velella-sh/org/blob/main/lateen/ROADMAP.md).
