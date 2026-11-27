# 0058 Lifecycle attestation v1

Status: Accepted

## Context

An SBOM identifies components and their lifecycle properties. Release consumers also need to bind that evidence to artifact bytes and to the exact Ebb dataset the producer read. They need to interpret a past observation independently, after its deadlines have passed.

## Decision

Publish a versioned in-toto lifecycle predicate and an enclosing Statement v1 schema. Record the UTC build day, artifact SHA-256, Ebb content digest, and rules and unknown observations. Re-evaluate deadlines offline by comparing the signed dates to a new UTC day. Repo scans supply findings and unclassified observations. An SBOM supplies a component inventory. Both paths use evidence already present in Ebb.

Offing produces unsigned statements. CI signs the predicate using an external workflow identity. Consumers authenticate the signature and subject with Sigstore tooling before projecting lifecycle dates. Ship an independent checker and reference verifier so consumers can check the contract without the Offing package.
