# 0068 Campaign and campaign state v1

Status: Accepted

## Context

Fleet summaries alone cannot prove the rule, runtime pin, or readiness of
each repository. Campaigns need reproducible selection and an interoperable
record of the planned batches and each repository's progress.

## Decision

Define versioned campaign and state documents. Use explicit dates and
immutable commit identities to evaluate opt-in Fleet observations.
Unknown and unavailable evidence produces explicit omissions. Order batches
by owner deadlines and stable repository IDs. Read-only readers enforce the
transition graph and reject discontinuous histories.

Keep planning and status read-only. Local execution reuses the approved
Autopilot replay and pinned container test plan. Each repository needs an
operator-mapped checkout at the planned commit, a selected finding and a
reviewed recording. Add an optional run checkpoint, outcome code, rollout
control and completed-batch check to the v1 state. Keep review and
publication state interoperable with host integrations.
