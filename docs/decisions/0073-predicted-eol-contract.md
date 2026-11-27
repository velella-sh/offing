# 0073 Keep predicted end-of-life evidence separate

Status: Accepted

## Context

Forecast v1 groups announced dates and counts the events that affect a
repository. Model estimates need their own provenance and uncertainty.

## Decision

Use an optional top-level `predictions` array in Forecast v1. Each entry
carries a versioned Package URL, the modeled date and its inclusive interval,
confidence, method, source links and model version. Existing event arrays,
counts and policy checks represent announced lifecycle evidence. Emitters
omit `predictions` when model evidence is unavailable.

The [predicted end-of-life contract](https://velella.sh/offing/spec/predicted-eol/v1/) also
specifies extension locations for SARIF, CycloneDX and SPDX. Those formats
can carry the same object independently from the announced-date profiles.
