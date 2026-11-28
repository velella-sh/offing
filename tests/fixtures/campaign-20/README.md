# Recorded 20-repository Node.js campaign

The campaign CLI produced this recording on isolated checkouts and forge
hosts. Package Smoke replays it from the installed candidate. The approved replay raises the Node.js engine
from `18` to `>=22`. The [walkthrough](../../../docs/CAMPAIGNS.md#replay-the-recorded-nodejs-18-to-22-campaign)
describes the four batches and the last fixture merge.

- `campaign.json` is the input. `fleet.json` records the scan at the pinned
  commits. `plan.json` and `state.json` are the saved CLI ledgers.
- `commits.fi` is a text Git fast-export stream. It contains the original
  pins under `refs/heads/pins/` and verified results under `refs/heads/results/`. The
  `refs/heads/host/` refs record the published fixture repositories'
  final default-branch heads.
- `evidence.json` contains the Campaign Board summary, verified proof
  files, redacted logs and the exact fixture request bodies.
- `sha256.json` binds these files to this recording.

From the repository root, use
`OFFING_CAMPAIGN_20=1 node --test dist/tests/campaign-20-fixture.test.js`
after building. Docker is required for the replay. The test compares the
stable plan, transitions, Git trees and Board summary with this snapshot,
and independently checks both sets of proofs and refs. An intentional
re-record uses the same command with `OFFING_CAMPAIGN_20_RECORD=1` and
replaces the recorded artifacts and their checksums.
