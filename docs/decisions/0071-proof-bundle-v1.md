# 0071 Migration proof v1

Status: Accepted

## Context

A migration pull request can carry multiple kinds of evidence. Reviewers
need to check the commit range and attached logs offline, even when the
original automation or its credentials are unavailable.

## Decision

Publish [proof v1](../spec/proof/v1.md) as a separate schema that embeds
the existing verification, test and agent documents by their canonical IDs.
Bind the scan identities to full Git commit IDs and measure added, changed
and deleted paths from those objects. Content-address redacted logs outside
the JSON and clear inline tails. Describe the result in Markdown above a
bounded machine block with a digest-bearing artifact fallback.

The CLI and independent checker confirm local consistency. Automation
provenance requires a separate signed attestation. Autopilot's preparation
record has no execution evidence, so proof publication accepts explicit
evidence supplied by the caller.
