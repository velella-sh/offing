# 0064 Autopilot guardrails configuration

Status: Accepted

## Context

Autopilot needs to carry limits for an explicitly requested run. Config readers,
editors and the runtime validator need the same vocabulary and safety defaults.

## Decision

Add an optional autopilot object to config v1. Default the driver to replay.
Omitting the entire object preserves the existing config output. Reading the
configuration starts no processes.

Cap wall time, turns, combined input and output tokens, and cost separately for a
run and a turn. Run defaults are five minutes, three turns, 30,000 tokens and
100 US cents. Turn defaults are two minutes, one turn, 10,000 tokens and 50 US
cents. A zero cost ceiling permits offline work. The caller receives the tighter
remaining ceilings before work starts and records the reason if the guard
refuses to continue. A live backend must enforce the admitted ceilings during
execution.

Use exact repository-relative paths. Omitting allowedPaths derives the scope
from selected migration packets and test files. An explicit empty list permits
no edits. Extra denials and built-in protections take precedence. Test argv
entries are candidates for approval by the execution caller.

Select child environments from a fixed baseline and one named driver
credential where needed. Tests and replay receive no model credentials.
Additional secret environment names only affect filtering and redaction. Replay
preflights recorded paths and contents before writing, so refusal evidence can
be checked without a model, provider key or remote service.
