# 0061 Release gate v1

Status: Accepted

## Context

Releases and rollback candidates need the same decision semantics for authoritative lifecycle deadlines. Consumers need a versioned result, reproducible calendar bounds, and an explicit interpretation of missing evidence.

## Decision

Publish one versioned decision document for the release gate and rollback readiness. Assess dated support, end-of-life, and removal rules within an inclusive UTC window, preserving their sources and the applicable exception. Keep missing evidence explicit and default it to warning. Use published Ebb observations and re-evaluate authenticated lifecycle statements, delegating signature and signer verification to GitHub CLI with a local Sigstore trust root. Keep the Action's gate opt-in and independent of its scan severity gate.
