# 0059 — Keep external codemod conformance declarative

Status: accepted

## Context

Offing treats repository files as untrusted input. The codemod kit adds a command authors can
run on their own fixtures. Node.js 22 remains supported and its permission model constrains
filesystem writes and child processes. Network restrictions in the reviewed planner subprocess
are a regression guard. [Node.js permissions](https://nodejs.org/docs/latest-v22.x/api/permissions.html)

## Decision

Built-ins use a typed planner that declares the rules and the expected replacement where available.
The build generates their registry in stable order. The existing fix plan and `fix --json` retain
their shapes. The [v1 specification](../spec/codemod/v1.md) defines the external declaration,
fixture case layout, and what the conformance command verifies. The external declaration is data.
It permits one exact line replacement per matching finding.

A future version may support more declarative transformations when there are concrete use cases.
Any proposal to execute third-party planners needs an isolation design and its own review.
