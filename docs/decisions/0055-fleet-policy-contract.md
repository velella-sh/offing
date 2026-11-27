# 0055 Fleet policy v1

Status: Accepted

## Context

Repository-local lifecycle gates already express named rules and date-limited exceptions. Sharing them across an organization requires a stable merge order and a reproducible remote source.

## Decision

Publish `offing.fleet-policy.v1`. Merge organization, team, and repository rule fields by ID, retaining an auditable origin per field. A lower layer can widen enforcement by default. Relaxation requires an organization delegation for that key. Fleet exceptions include owner, reason and expiry. Existing policies outside inheritance keep their previous semantics.

Use a read-only provider request by explicit opt-in to resolve a named ref to a commit, then read the policy at that commit. Keep the verified bytes in Offing's user cache by immutable commit. Offline consumers fail if a selected remote policy is unavailable locally. Expose local and pinned policies through the CLI and Action.
