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

Ship only the evidenced planning and state-reading entry points. Execution
depends on an isolated Autopilot loop and per-repository proof.
